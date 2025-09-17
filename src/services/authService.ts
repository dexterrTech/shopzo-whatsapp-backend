import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/database';
import { env } from '../config/env';
import crypto from 'crypto';
import { sendAggregatorInviteEmail, sendVerificationLink } from './emailService';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'user' | 'aggregator' | 'super_admin';
  is_approved: boolean;
  is_active: boolean;
  created_at: Date;
  last_login_at?: Date;
  aggregator_name?: string;
  mobile_no?: string;
  gst_required?: boolean;
  gst_number?: string;
}

export interface RegisterUserData {
  name: string;
  email: string;
  password: string;
}

export interface CreateAggregatorData {
  name: string;
  email: string;
  mobile_no?: string;
  gst_required?: boolean;
  gst_number?: string;
  aggregator_name?: string;
  aggregator_address?: string;
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
  static async createAggregator(userData: CreateAggregatorData): Promise<Omit<User, 'password_hash'>> {
    const { name, email, mobile_no, gst_required = false, gst_number, aggregator_name, aggregator_address } = userData;

    const existingUser = await pool.query(
      'SELECT id FROM users_whatsapp WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    // Generate random temporary password
    const tempPassword = crypto.randomBytes(12).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, this.SALT_ROUNDS);

    // Create verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const result = await pool.query(
      `INSERT INTO users_whatsapp (name, email, password_hash, role, is_approved, is_active, mobile_no, gst_required, gst_number, aggregator_name, aggregator_address, verification_token, verification_expires_at, must_change_password)
       VALUES ($1, $2, $3, $4, FALSE, FALSE, $5, $6, $7, $8, $9, $10, $11, TRUE)
       RETURNING id, name, email, role, is_approved, is_active, created_at, mobile_no, gst_required, gst_number, aggregator_name, aggregator_address, verification_token, verification_expires_at`,
      [name, email, passwordHash, 'aggregator', mobile_no, gst_required, gst_number, aggregator_name || null, aggregator_address || null, verificationToken, verificationExpiresAt]
    );

    // Send verification email with credentials
    try {
      const feBase = env.FRONTEND_BASE_URL;
      const beBase = env.API_BASE_URL || env.SERVER_URL || '';
      const verifyUrl = feBase && feBase.length
        ? `${feBase.replace(/\/$/, '')}/verify?token=${verificationToken}`
        : `${beBase.replace(/\/$/, '')}/api/auth/verify?token=${verificationToken}`;
      await sendAggregatorInviteEmail({
        to: email,
        tempPassword,
        verifyUrl,
        username: email,
        aggregatorName: name,
      });
    } catch (e) {
      // Do not fail creation if email send fails; log and continue
      console.warn('Failed to send aggregator invite email:', (e as any)?.message || e);
    }

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
  static async moveBusinessToAggregator(childUserId: number, newAggregatorUserId: number | null): Promise<void> {
    // Validate roles
    const child = await pool.query('SELECT id, role FROM users_whatsapp WHERE id = $1', [childUserId]);
    if (child.rows.length === 0 || child.rows[0].role !== 'user') {
      throw new Error('Invalid business user');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Remove any existing parent
      await client.query('DELETE FROM user_children WHERE child_user_id = $1', [childUserId]);
      
      // If newAggregatorUserId is provided, add new mapping
      if (newAggregatorUserId && newAggregatorUserId > 0) {
        const agg = await pool.query('SELECT id, role FROM users_whatsapp WHERE id = $1', [newAggregatorUserId]);
        if (agg.rows.length === 0 || agg.rows[0].role !== 'aggregator') {
          throw new Error('Invalid aggregator');
        }
        // Add new mapping
        await client.query('INSERT INTO user_children (parent_user_id, child_user_id) VALUES ($1, $2)', [newAggregatorUserId, childUserId]);
      }
      // If newAggregatorUserId is 0 or null, just remove the relationship (unassign)
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Unassign a business user from any aggregator (super admin only)
   */
  static async unassignBusinessFromAggregator(childUserId: number): Promise<void> {
    // Validate that the user is a business
    const child = await pool.query('SELECT id, role FROM users_whatsapp WHERE id = $1', [childUserId]);
    if (child.rows.length === 0 || child.rows[0].role !== 'user') {
      throw new Error('Invalid business user');
    }

    // Remove the relationship
    await pool.query('DELETE FROM user_children WHERE child_user_id = $1', [childUserId]);
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
    await pool.query('UPDATE users_whatsapp SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
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
    // Require email verification only for aggregators
    if (user.role === 'aggregator' && !user.email_verified_at) {
      throw new Error('Email not verified. Please check your inbox for the verification link.');
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

  static async verifyEmailByToken(token: string): Promise<{ id: number; email: string }> {
    const res = await pool.query(
      `SELECT id, email, verification_expires_at FROM users_whatsapp WHERE verification_token = $1 LIMIT 1`,
      [token]
    );
    if (res.rows.length === 0) {
      throw new Error('Invalid verification token');
    }
    const row = res.rows[0];
    if (row.verification_expires_at && new Date(row.verification_expires_at).getTime() < Date.now()) {
      throw new Error('Verification token has expired');
    }
    await pool.query(
      `UPDATE users_whatsapp 
       SET is_active = TRUE, is_approved = TRUE, email_verified_at = CURRENT_TIMESTAMP, verification_token = NULL, verification_expires_at = NULL
       WHERE id = $1`,
      [row.id]
    );
    return { id: row.id, email: row.email };
  }

  static async resendVerification(email: string): Promise<void> {
    const userRes = await pool.query(
      `SELECT id, email, email_verified_at FROM users_whatsapp WHERE email = $1 LIMIT 1`,
      [email]
    );
    if (userRes.rows.length === 0) {
      // Do not leak existence
      return;
    }
    const user = userRes.rows[0];
    if (user.email_verified_at) {
      return; // Already verified
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `UPDATE users_whatsapp SET verification_token = $1, verification_expires_at = $2 WHERE id = $3`,
      [token, expires, user.id]
    );
    const feBase = env.FRONTEND_BASE_URL;
    const beBase = env.API_BASE_URL || env.SERVER_URL || '';
    const verifyUrl = feBase && feBase.length
      ? `${feBase.replace(/\/$/, '')}/verify?token=${token}`
      : `${beBase.replace(/\/$/, '')}/api/auth/verify?token=${token}`;
    await sendVerificationLink(email, verifyUrl);
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
      `SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.is_approved,
        u.is_active,
        u.created_at,
        u.last_login_at,
        u.mobile_no,
        u.gst_required,
        u.gst_number,
        CASE
          WHEN u.role = 'user' THEN agg.name
          ELSE NULL
        END as aggregator_name
       FROM users_whatsapp u
       LEFT JOIN user_children uc ON u.id = uc.child_user_id
       LEFT JOIN users_whatsapp agg ON uc.parent_user_id = agg.id
       ORDER BY u.created_at DESC`
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
       SET role = $1 
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
       SET is_active = FALSE 
       WHERE id = $1 
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
       SET is_active = TRUE 
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
