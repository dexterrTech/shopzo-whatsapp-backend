import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database';
import { env } from '../config/env';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'user' | 'aggregator' | 'super_admin';
  is_approved: boolean;
  is_active: boolean;
  created_at: Date;
  last_login_at?: Date;
}

export interface RegisterUserData {
  name: string;
  email: string;
  password: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
}

export class AuthService {
  private static readonly SALT_ROUNDS = 12;

  /**
   * Register a new user
   */
  static async registerUser(userData: RegisterUserData): Promise<Omit<User, 'password_hash'>> {
    const { name, email, password } = userData;

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users_whatsapp WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS);

    // Insert new user
    const result = await pool.query(
      `INSERT INTO users_whatsapp (name, email, password_hash, role) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, name, email, role, is_approved, is_active, created_at`,
      [name, email, passwordHash, 'user']
    );

    return result.rows[0];
  }

  /**
   * Create an aggregator (super admin only caller should enforce)
   */
  static async createAggregator(userData: RegisterUserData): Promise<Omit<User, 'password_hash'>> {
    const { name, email, password } = userData;

    const existingUser = await pool.query(
      'SELECT id FROM users_whatsapp WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users_whatsapp (name, email, password_hash, role, is_approved, is_active) 
       VALUES ($1, $2, $3, $4, TRUE, TRUE) 
       RETURNING id, name, email, role, is_approved, is_active, created_at`,
      [name, email, passwordHash, 'aggregator']
    );

    return result.rows[0];
  }

  /**
   * Create a business user under an aggregator
   */
  static async createBusinessUnderAggregator(aggregatorUserId: number, userData: RegisterUserData): Promise<Omit<User, 'password_hash'>> {
    // Ensure aggregator exists and has correct role
    const agg = await pool.query('SELECT id, role, is_active, is_approved FROM users_whatsapp WHERE id = $1', [aggregatorUserId]);
    if (agg.rows.length === 0 || agg.rows[0].role !== 'aggregator') {
      throw new Error('Invalid aggregator');
    }
    if (!agg.rows[0].is_active || !agg.rows[0].is_approved) {
      throw new Error('Aggregator is not active or approved');
    }

    const { name, email, password } = userData;
    const exists = await pool.query('SELECT id FROM users_whatsapp WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, this.SALT_ROUNDS);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO users_whatsapp (name, email, password_hash, role, is_approved, is_active)
         VALUES ($1, $2, $3, 'user', TRUE, TRUE)
         RETURNING id, name, email, role, is_approved, is_active, created_at`,
        [name, email, passwordHash]
      );
      const childId = inserted.rows[0].id;
      // Map relationship
      await client.query(
        `INSERT INTO user_children (parent_user_id, child_user_id) VALUES ($1, $2)
         ON CONFLICT (parent_user_id, child_user_id) DO NOTHING`,
        [aggregatorUserId, childId]
      );
      await client.query('COMMIT');
      return inserted.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Move a business user to another aggregator (super admin only)
   */
  static async moveBusinessToAggregator(childUserId: number, newAggregatorUserId: number): Promise<void> {
    // Validate roles
    const child = await pool.query('SELECT id, role FROM users_whatsapp WHERE id = $1', [childUserId]);
    if (child.rows.length === 0 || child.rows[0].role !== 'user') {
      throw new Error('Invalid business user');
    }
    const agg = await pool.query('SELECT id, role FROM users_whatsapp WHERE id = $1', [newAggregatorUserId]);
    if (agg.rows.length === 0 || agg.rows[0].role !== 'aggregator') {
      throw new Error('Invalid aggregator');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Remove any existing parent
      await client.query('DELETE FROM user_children WHERE child_user_id = $1', [childUserId]);
      // Add new mapping
      await client.query('INSERT INTO user_children (parent_user_id, child_user_id) VALUES ($1, $2)', [newAggregatorUserId, childUserId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * List businesses for aggregator
   */
  static async listBusinessesForAggregator(aggregatorUserId: number): Promise<User[]> {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.is_approved, u.is_active, u.created_at, u.last_login_at
       FROM user_children uc
       JOIN users_whatsapp u ON u.id = uc.child_user_id
       WHERE uc.parent_user_id = $1
       ORDER BY u.created_at DESC`,
      [aggregatorUserId]
    );
    return result.rows;
  }

  /**
   * Set/Update user password (admin only)
   */
  static async setUserPassword(userId: number, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, this.SALT_ROUNDS);
    await pool.query('UPDATE users_whatsapp SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [passwordHash, userId]);
  }

  /**
   * Login user
   */
  static async loginUser(loginData: LoginData): Promise<{ user: User; token: string }> {
    const { email, password } = loginData;

    // Find user by email
    const result = await pool.query(
      'SELECT * FROM users_whatsapp WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = result.rows[0];

    // Check if user is active
    if (!user.is_active) {
      throw new Error('Account is deactivated');
    }

    // Check if user is approved
    if (!user.is_approved) {
      throw new Error('Account is not approved yet. Please wait for admin approval.');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new Error('Invalid email or password');
    }

    // Update last login
    await pool.query(
      'UPDATE users_whatsapp SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    // Generate JWT token
    const token = this.generateToken({
      userId: user.id,
      email: user.email,
      role: user.role
    });

    // Remove password_hash from user object
    const { password_hash, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      token
    };
  }

  /**
   * Generate JWT token
   */
  static generateToken(payload: JWTPayload): string {
    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn']
    });
  }

  /**
   * Verify JWT token
   */
  static verifyToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET) as JWTPayload;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId: number): Promise<User | null> {
    const result = await pool.query(
      'SELECT id, name, email, role, is_approved, is_active, created_at, last_login_at FROM users_whatsapp WHERE id = $1',
      [userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Get all users (for admin)
   */
  static async getAllUsers(): Promise<User[]> {
    const result = await pool.query(
      'SELECT id, name, email, role, is_approved, is_active, created_at, last_login_at FROM users_whatsapp ORDER BY created_at DESC'
    );

    return result.rows;
  }

  /**
   * Get pending users (for admin approval)
   */
  static async getPendingUsers(): Promise<User[]> {
    const result = await pool.query(
      'SELECT id, name, email, role, is_approved, is_active, created_at FROM users_whatsapp WHERE is_approved = FALSE ORDER BY created_at ASC'
    );

    return result.rows;
  }

  /**
   * Approve user (admin only)
   */
  static async approveUser(userId: number, approvedBy: number): Promise<User> {
    const result = await pool.query(
      `UPDATE users_whatsapp 
       SET is_approved = TRUE, approved_by = $1, approved_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, name, email, role, is_approved, is_active, created_at, last_login_at`,
      [approvedBy, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    return result.rows[0];
  }

  /**
   * Update user role (super admin only)
   */
  static async updateUserRole(userId: number, role: 'user' | 'aggregator' | 'super_admin'): Promise<User> {
    const result = await pool.query(
      `UPDATE users_whatsapp 
       SET role = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, name, email, role, is_approved, is_active, created_at, last_login_at`,
      [role, userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    return result.rows[0];
  }

  /**
   * Deactivate user (admin only)
   */
  static async deactivateUser(userId: number): Promise<User> {
    const result = await pool.query(
      `UPDATE users_whatsapp 
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING id, name, email, role, is_approved, is_active, created_at, last_login_at`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    return result.rows[0];
  }

  /**
   * Activate user (admin only)
   */
  static async activateUser(userId: number): Promise<User> {
    const result = await pool.query(
      `UPDATE users_whatsapp 
       SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING id, name, email, role, is_approved, is_active, created_at, last_login_at`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    return result.rows[0];
  }
}
