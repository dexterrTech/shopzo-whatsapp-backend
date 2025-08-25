import { Router } from 'express';
import { z } from 'zod';
import { WalletService } from '../services/walletService';
import { authenticateToken, requireAdmin, requireSuperAdmin, requireAggregator } from '../middleware/authMiddleware';
import { pool } from '../config/database';

const router = Router();

// Validation schemas
const rechargeSchema = z.object({
  toUserId: z.number().int().positive(),
  amountPaise: z.number().int().positive(),
  details: z.string().optional()
});

const transactionQuerySchema = z.object({
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().int().positive().max(100)).default(50),
  offset: z.string().transform(val => parseInt(val)).pipe(z.number().int().min(0)).default(0)
});

/**
 * @swagger
 * /api/wallet/balance:
 *   get:
 *     summary: Get user wallet balance
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balance retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const account = await WalletService.getOrCreateWalletAccount(userId);
    
    res.json({
      success: true,
      data: {
        balance: account.balance_paise / 100, // Convert paise to rupees
        balance_paise: account.balance_paise,
        suspense_balance: (account.suspense_balance_paise || 0) / 100,
        suspense_balance_paise: account.suspense_balance_paise || 0,
        currency: account.currency
      }
    });
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet balance'
    });
  }
});

/**
 * @swagger
 * /api/wallet/transactions:
 *   get:
 *     summary: Get user wallet transactions
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of transactions to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of transactions to skip
 *     responses:
 *       200:
 *         description: Transactions retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { limit, offset } = transactionQuerySchema.parse(req.query);
    
    const transactions = await WalletService.getWalletTransactions(userId, limit, offset);
    
    res.json({
      success: true,
      data: transactions.map(tx => ({
        ...tx,
        amount: tx.amount_paise / 100, // Convert paise to rupees
        balance_after: tx.balance_after_paise ? tx.balance_after_paise / 100 : undefined,
        suspense_balance_after: tx.suspense_balance_after_paise ? tx.suspense_balance_after_paise / 100 : undefined
      }))
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.issues
      });
    }
    
    console.error('Error getting wallet transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet transactions'
    });
  }
});

/**
 * @swagger
 * /api/wallet/recharge:
 *   post:
 *     summary: Recharge user wallet (Super Admin or Aggregator only)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - toUserId
 *               - amountPaise
 *             properties:
 *               toUserId:
 *                 type: integer
 *               amountPaise:
 *                 type: integer
 *               details:
 *                 type: string
 *     responses:
 *       200:
 *         description: Wallet recharged successfully
 *       400:
 *         description: Validation error or insufficient balance
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.post('/recharge', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const fromUserId = req.user!.userId;
    const validatedData = rechargeSchema.parse(req.body);
    
    let transaction;
    
    // Check if user is Super Admin or if they're recharging their own businesses
    if (req.user!.role === 'super_admin') {
      // Super Admin recharges from system wallet
      transaction = await WalletService.rechargeFromSystemWallet(
        validatedData.toUserId,
        validatedData.amountPaise,
        validatedData.details
      );
    } else {
      // For aggregators, check if they're recharging their own businesses
      const relationships = await WalletService.getUserRelationships(fromUserId, 'business');
      const hasBusiness = relationships.some(rel => rel.child_user_id === validatedData.toUserId);
      
      if (!hasBusiness) {
        return res.status(403).json({
          success: false,
          message: 'You can only recharge wallets of your own businesses'
        });
      }
      
      transaction = await WalletService.rechargeWallet(
        fromUserId,
        validatedData.toUserId,
        validatedData.amountPaise,
        validatedData.details
      );
    }
    
    res.json({
      success: true,
      message: 'Wallet recharged successfully',
      data: {
        ...transaction,
        amount: transaction.amount_paise / 100
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    if (error instanceof Error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    console.error('Error recharging wallet:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to recharge wallet'
    });
  }
});

/**
 * @swagger
 * /api/wallet/system-balance:
 *   get:
 *     summary: Get system wallet balance (Super Admin only)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System wallet balance retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.get('/system-balance', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const balance = await WalletService.getSystemWalletBalance();
    
    res.json({
      success: true,
      data: {
        balance: balance / 100, // Convert paise to rupees
        balance_paise: balance,
        currency: 'INR'
      }
    });
  } catch (error) {
    console.error('Error getting system wallet balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system wallet balance'
    });
  }
});

/**
 * @swagger
 * /api/wallet/businesses:
 *   get:
 *     summary: Get businesses under aggregator with wallet balances
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Businesses retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.get('/businesses', authenticateToken, requireAggregator, async (req, res) => {
  try {
    const aggregatorId = req.user!.userId;
    const relationships = await WalletService.getUserRelationships(aggregatorId, 'business');
    
    // Get wallet balances for all businesses
    const businessesWithBalances = await Promise.all(
      relationships.map(async (rel) => {
        const account = await WalletService.getWalletAccount(rel.child_user_id);
        return {
          relationshipId: rel.id,
          businessId: rel.child_user_id,
          status: rel.status,
          createdAt: rel.created_at,
          walletBalance: account ? account.balance_paise / 100 : 0,
          walletBalancePaise: account ? account.balance_paise : 0
        };
      })
    );
    
    res.json({
      success: true,
      data: businessesWithBalances
    });
  } catch (error) {
    console.error('Error getting businesses with balances:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get businesses with balances'
    });
  }
});

/**
 * @swagger
 * /api/wallet/all-users:
 *   get:
 *     summary: Get all users with wallet balances (Super Admin only)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Users with wallet balances retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.get('/all-users', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    // Check if suspense_balance_paise column exists
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'wallet_accounts' 
      AND column_name = 'suspense_balance_paise'
    `);
    
    const hasSuspenseColumn = columnCheck.rows.length > 0;
    
    // Build query based on available columns
    let query = `
      SELECT 
        wa.user_id,
        wa.balance_paise,
        wa.currency,
        wa.updated_at
    `;
    
    if (hasSuspenseColumn) {
      query += `, wa.suspense_balance_paise`;
    }
    
    query += `
      FROM wallet_accounts wa
      ORDER BY wa.updated_at DESC
    `;
    
    const result = await pool.query(query);
    
    const usersWithBalances = result.rows.map(row => ({
      userId: row.user_id,
      balance_paise: row.balance_paise || 0,
      suspense_balance_paise: hasSuspenseColumn ? (row.suspense_balance_paise || 0) : 0,
      currency: row.currency || 'INR',
      lastUpdated: row.updated_at || new Date().toISOString()
    }));
    
    res.json({
      success: true,
      data: usersWithBalances
    });
  } catch (error) {
    console.error('Error getting all users with balances:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users with balances'
    });
  }
});

export default router;


