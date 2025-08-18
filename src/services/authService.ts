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
