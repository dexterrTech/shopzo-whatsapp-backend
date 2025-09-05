import { pool } from '../config/database';

export interface WalletAccount {
  id: number;
  user_id: number;
  currency: string;
  balance_paise: number;
  suspense_balance_paise?: number;
  created_at: Date;
  updated_at: Date;
}

export interface WalletTransaction {
  id: number;
  user_id: number;
  transaction_id: string;
  type: 'RECHARGE' | 'DEBIT' | 'REFUND' | 'ADJUSTMENT' | 'SUSPENSE_DEBIT' | 'SUSPENSE_REFUND';
  status: 'completed' | 'pending' | 'failed';
  amount_paise: number;
  currency: string;
  details?: string;
  from_label?: string;
  to_label?: string;
  balance_after_paise?: number;
  suspense_balance_after_paise?: number;
  created_at: Date;
}

export interface UserRelationship {
  id: number;
  parent_user_id: number;
  child_user_id: number;
  relationship_type: 'business' | 'aggregator';
  status: 'active' | 'inactive' | 'pending';
  created_at: Date;
  updated_at: Date;
}

export class WalletService {
  // Get wallet account for a user
  static async getWalletAccount(userId: number): Promise<WalletAccount | null> {
    try {
      const result = await pool.query(
        'SELECT * FROM wallet_accounts WHERE user_id = $1',
        [userId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting wallet account:', error);
      throw new Error('Failed to get wallet account');
    }
  }

  // Create wallet account for a user
  static async createWalletAccount(userId: number, currency: string = 'INR'): Promise<WalletAccount> {
    try {
      const result = await pool.query(
        'INSERT INTO wallet_accounts (user_id, currency, balance_paise, suspense_balance_paise) VALUES ($1, $2, $3, $4) RETURNING *',
        [userId, currency, 0, 0]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error creating wallet account:', error);
      throw new Error('Failed to create wallet account');
    }
  }

  // Get or create wallet account
  static async getOrCreateWalletAccount(userId: number): Promise<WalletAccount> {
    let account = await this.getWalletAccount(userId);
    if (!account) {
      // Check if suspense_balance_paise column exists
      const columnCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'wallet_accounts' 
        AND column_name = 'suspense_balance_paise'
      `);
      
      const hasSuspenseColumn = columnCheck.rows.length > 0;
      
      if (hasSuspenseColumn) {
        account = await this.createWalletAccount(userId);
      } else {
        // Create wallet account without suspense_balance_paise
        try {
          const result = await pool.query(
            'INSERT INTO wallet_accounts (user_id, currency, balance_paise) VALUES ($1, $2, $3) RETURNING *',
            [userId, 'INR', 0]
          );
          account = result.rows[0];
        } catch (error) {
          console.error('Error creating wallet account without suspense column:', error);
          throw new Error('Failed to create wallet account');
        }
      }
    }
    
    // Ensure account is not null at this point
    if (!account) {
      throw new Error('Failed to create or retrieve wallet account');
    }
    
    return account;
  }

  // Recharge wallet (Super Admin or Aggregator to User)
  static async rechargeWallet(
    fromUserId: number,
    toUserId: number,
    amountPaise: number,
    details?: string
  ): Promise<WalletTransaction> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get or create wallet accounts
      const fromAccount = await this.getOrCreateWalletAccount(fromUserId);
      const toAccount = await this.getOrCreateWalletAccount(toUserId);

      // Check if from account has sufficient balance
      if (fromAccount.balance_paise < amountPaise) {
        throw new Error('Insufficient balance');
      }

      // Deduct from source account
      const newFromBalance = fromAccount.balance_paise - amountPaise;
      await client.query(
        'UPDATE wallet_accounts SET balance_paise = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
        [newFromBalance, fromUserId]
      );

      // Add to destination account
      const newToBalance = toAccount.balance_paise + amountPaise;
      await client.query(
        'UPDATE wallet_accounts SET balance_paise = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
        [newToBalance, toUserId]
      );

      // Create transaction records
      const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Debit transaction
      const debitResult = await client.query(
        `INSERT INTO wallet_transactions 
         (user_id, transaction_id, type, amount_paise, currency, details, from_label, to_label, balance_after_paise) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [fromUserId, transactionId + '_DEBIT', 'DEBIT', amountPaise, 'INR', details, 'Wallet', 'User Recharge', newFromBalance]
      );

      // Recharge transaction
      const rechargeResult = await client.query(
        `INSERT INTO wallet_transactions 
         (user_id, transaction_id, type, amount_paise, currency, details, from_label, to_label, balance_after_paise) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [toUserId, transactionId + '_RECHARGE', 'RECHARGE', amountPaise, 'INR', details, 'Wallet Recharge', 'Wallet', newToBalance]
      );

      await client.query('COMMIT');
      return rechargeResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error recharging wallet:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Deduct from wallet (for message sending)
  static async deductFromWallet(
    userId: number,
    amountPaise: number,
    category: string,
    conversationId: string
  ): Promise<WalletTransaction> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get wallet account
      const account = await this.getOrCreateWalletAccount(userId);

      // Check if user has sufficient balance
      if (account.balance_paise < amountPaise) {
        throw new Error('Insufficient balance');
      }

      // Deduct from main balance and add to suspense
      const newBalance = account.balance_paise - amountPaise;
      const newSuspenseBalance = (account.suspense_balance_paise || 0) + amountPaise;

      await client.query(
        'UPDATE wallet_accounts SET balance_paise = $1, suspense_balance_paise = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
        [newBalance, newSuspenseBalance, userId]
      );

      // Create transaction record
      const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const result = await client.query(
        `INSERT INTO wallet_transactions 
         (user_id, transaction_id, type, amount_paise, currency, details, from_label, to_label, balance_after_paise, suspense_balance_after_paise) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [userId, transactionId, 'SUSPENSE_DEBIT', amountPaise, 'INR', `${category} message - ${conversationId}`, 'Wallet', 'Suspense Account', newBalance, newSuspenseBalance]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deducting from wallet:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Confirm message delivery and finalize deduction
  static async confirmMessageDelivery(
    userId: number,
    conversationId: string,
    wasDelivered: boolean
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Find the suspense transaction
      // Try both full conversation ID and truncated version (for backward compatibility)
      const transactionResult = await client.query(
        `SELECT * FROM wallet_transactions 
         WHERE user_id = $1 AND type = 'SUSPENSE_DEBIT' 
         AND (transaction_id LIKE $2 OR transaction_id LIKE $3)`,
        [userId, `%${conversationId}%`, `%${conversationId.substring(0, 50)}%`]
      );

      if (transactionResult.rows.length === 0) {
        throw new Error('Suspense transaction not found');
      }

      const transaction = transactionResult.rows[0];
      const account = await this.getWalletAccount(userId);

      if (!account) {
        throw new Error('Wallet account not found');
      }

      if (wasDelivered) {
        // Message was delivered, keep the amount in suspense (it will be deducted later)
        // Update billing log status to 'paid'
        await client.query(
          'UPDATE billing_logs SET billing_status = $1, wallet_tx_id = $2 WHERE conversation_id = $3',
          ['paid', transaction.id, conversationId]
        );
      } else {
        // Message was not delivered, refund the amount
        const newBalance = account.balance_paise + transaction.amount_paise;
        const newSuspenseBalance = (account.suspense_balance_paise || 0) - transaction.amount_paise;

        await client.query(
          'UPDATE wallet_accounts SET balance_paise = $1, suspense_balance_paise = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
          [newBalance, newSuspenseBalance, userId]
        );

        // Create refund transaction
        const refundTransactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await client.query(
          `INSERT INTO wallet_transactions 
           (user_id, transaction_id, type, amount_paise, currency, details, from_label, to_label, balance_after_paise, suspense_balance_after_paise) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [userId, refundTransactionId, 'SUSPENSE_REFUND', transaction.amount_paise, 'INR', `Refund for failed delivery - ${conversationId}`, 'Suspense Account', 'Wallet', newBalance, newSuspenseBalance]
        );

        // Update billing log status to 'failed'
        await client.query(
          'UPDATE billing_logs SET billing_status = $1 WHERE conversation_id = $2',
          ['failed', conversationId]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error confirming message delivery:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Get user relationships (aggregator -> businesses)
  static async getUserRelationships(userId: number, relationshipType?: string): Promise<UserRelationship[]> {
    try {
      // Primary: new relationship table
      let query = 'SELECT * FROM user_relationships WHERE parent_user_id = $1';
      const params: (number | string)[] = [userId];

      if (relationshipType) {
        query += ' AND relationship_type = $2';
        params.push(relationshipType);
      }

      query += ' ORDER BY created_at DESC';

      const result = await pool.query(query, params);

      if (result.rows.length > 0) {
        return result.rows as UserRelationship[];
      }

      // Fallback: legacy mapping in user_children (parent_user_id -> child_user_id)
      // This keeps existing installations working without migrating data.
      const legacy = await pool.query(
        `SELECT 
           uc.child_user_id AS id,
           uc.parent_user_id,
           uc.child_user_id,
           'business'::text AS relationship_type,
           'active'::text AS status,
           NOW() AS created_at,
           NOW() AS updated_at
         FROM user_children uc
         WHERE uc.parent_user_id = $1
         ORDER BY uc.child_user_id DESC`,
        [userId]
      );

      return legacy.rows as UserRelationship[];
    } catch (error) {
      console.error('Error getting user relationships:', error);
      throw new Error('Failed to get user relationships');
    }
  }

  // Create user relationship
  static async createUserRelationship(
    parentUserId: number,
    childUserId: number,
    relationshipType: string = 'business'
  ): Promise<UserRelationship> {
    try {
      const result = await pool.query(
        `INSERT INTO user_relationships (parent_user_id, child_user_id, relationship_type) 
         VALUES ($1, $2, $3) RETURNING *`,
        [parentUserId, childUserId, relationshipType]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error creating user relationship:', error);
      throw new Error('Failed to create user relationship');
    }
  }

  // Get wallet transactions for a user
  static async getWalletTransactions(
    userId: number,
    limit: number = 50,
    offset: number = 0
  ): Promise<WalletTransaction[]> {
    try {
      const result = await pool.query(
        'SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [userId, limit, offset]
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting wallet transactions:', error);
      throw new Error('Failed to get wallet transactions');
    }
  }

  // Get system wallet balance
  static async getSystemWalletBalance(): Promise<number> {
    try {
      const result = await pool.query(
        'SELECT balance_paise FROM system_wallet WHERE wallet_type = $1',
        ['main']
      );
      return result.rows[0]?.balance_paise || 0;
    } catch (error) {
      console.error('Error getting system wallet balance:', error);
      throw new Error('Failed to get system wallet balance');
    }
  }

  // Update system wallet balance
  static async updateSystemWalletBalance(amountPaise: number, operation: 'add' | 'subtract'): Promise<void> {
    try {
      if (operation === 'add') {
        await pool.query(
          'UPDATE system_wallet SET balance_paise = balance_paise + $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_type = $2',
          [amountPaise, 'main']
        );
      } else {
        await pool.query(
          'UPDATE system_wallet SET balance_paise = balance_paise - $1, updated_at = CURRENT_TIMESTAMP WHERE wallet_type = $2',
          [amountPaise, 'main']
        );
      }
    } catch (error) {
      console.error('Error updating system wallet balance:', error);
      throw new Error('Failed to update system wallet balance');
    }
  }

  // Recharge user wallet from system wallet (Super Admin only)
  static async rechargeFromSystemWallet(
    toUserId: number,
    amountPaise: number,
    details?: string
  ): Promise<WalletTransaction> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get or create wallet account for the user
      const toAccount = await this.getOrCreateWalletAccount(toUserId);

      // Check if system wallet has sufficient balance
      const systemBalance = await this.getSystemWalletBalance();
      if (systemBalance < amountPaise) {
        throw new Error('Insufficient system wallet balance');
      }

      // Deduct from system wallet
      await this.updateSystemWalletBalance(amountPaise, 'subtract');

      // Add to user account
      const newToBalance = toAccount.balance_paise + amountPaise;
      await client.query(
        'UPDATE wallet_accounts SET balance_paise = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
        [newToBalance, toUserId]
      );

      // Create transaction record
      const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const result = await client.query(
        `INSERT INTO wallet_transactions 
         (user_id, transaction_id, type, amount_paise, currency, details, from_label, to_label, balance_after_paise) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [toUserId, transactionId, 'RECHARGE', amountPaise, 'INR', details || 'System wallet recharge', 'System Wallet', 'Wallet', newToBalance]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error recharging from system wallet:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}
