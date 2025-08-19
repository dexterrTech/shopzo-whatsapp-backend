import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, requireSuperAdmin } from '../middleware/authMiddleware';
import { pool } from '../config/database';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Wallet balances and transactions
 */

// Ensure a wallet account exists for the user
async function ensureWallet(userId: number) {
  await pool.query(
    `INSERT INTO wallet_accounts (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

// Get my wallet balance and recent transactions
/**
 * @swagger
 * /api/wallet/me:
 *   get:
 *     summary: Get current user's wallet summary
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     balance_paise:
 *                       type: integer
 *                       example: 2360915
 *                     currency:
 *                       type: string
 *                       example: INR
 *                     transactions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: integer }
 *                           transaction_id: { type: string }
 *                           type: { type: string, enum: [RECHARGE, DEBIT, REFUND, ADJUSTMENT] }
 *                           status: { type: string, enum: [completed, pending, failed] }
 *                           amount_paise: { type: integer }
 *                           currency: { type: string }
 *                           details: { type: string }
 *                           balance_after_paise: { type: integer }
 *                           created_at: { type: string, format: date-time }
 */
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user?.userId!;
    await ensureWallet(userId);

    const balanceRes = await pool.query(
      'SELECT balance_paise, currency FROM wallet_accounts WHERE user_id = $1',
      [userId]
    );

    const txRes = await pool.query(
      `SELECT id, transaction_id, type, status, amount_paise, currency, details, from_label, to_label, balance_after_paise, created_at
       FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    res.json({
      data: {
        balance_paise: balanceRes.rows[0]?.balance_paise ?? 0,
        currency: balanceRes.rows[0]?.currency ?? 'INR',
        transactions: txRes.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Get paginated wallet logs for current user
/**
 * @swagger
 * /api/wallet/logs:
 *   get:
 *     summary: Get paginated wallet transactions for current user
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [RECHARGE, DEBIT, REFUND, ADJUSTMENT] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [completed, pending, failed] }
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Paginated wallet logs
 */
router.get('/logs', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user?.userId!;
    await ensureWallet(userId);

    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20),
        type: z.enum(['RECHARGE', 'DEBIT', 'REFUND', 'ADJUSTMENT']).optional(),
        status: z.enum(['completed', 'pending', 'failed']).optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
      })
      .parse(req.query);

    let where = 'WHERE user_id = $1';
    const params: any[] = [userId];
    let idx = 2;

    if (query.type) { where += ` AND type = $${idx++}`; params.push(query.type); }
    if (query.status) { where += ` AND status = $${idx++}`; params.push(query.status); }
    if (query.start_date) { where += ` AND created_at >= $${idx++}`; params.push(query.start_date); }
    if (query.end_date) { where += ` AND created_at <= $${idx++}`; params.push(query.end_date); }

    const countRes = await pool.query(`SELECT COUNT(*) FROM wallet_transactions ${where}`, params);
    const total = parseInt(countRes.rows[0].count);
    const offset = (query.page - 1) * query.limit;

    const logsRes = await pool.query(
      `SELECT id, transaction_id, type, status, amount_paise, currency, details, from_label, to_label, balance_after_paise, created_at
       FROM wallet_transactions
       ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, query.limit, offset]
    );

    res.json({
      data: {
        logs: logsRes.rows,
        pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) },
      },
    });
  } catch (err) {
    next(err);
  }
});

// Super admin: list balances for all users (and aggregators), with optional user filter
/**
 * @swagger
 * /api/wallet/balances:
 *   get:
 *     summary: Get wallet balances for all users (super admin only)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema: { type: integer }
 *         required: false
 *     responses:
 *       200:
 *         description: List of balances
 */
router.get('/balances', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const query = z
      .object({ user_id: z.coerce.number().int().positive().optional() })
      .parse(req.query);

    const rows = await pool.query(
      `SELECT u.id as user_id, u.name, u.email, u.role, COALESCE(w.balance_paise, 0) AS balance_paise, COALESCE(w.currency, 'INR') as currency
       FROM users_whatsapp u
       LEFT JOIN wallet_accounts w ON w.user_id = u.id
       ${query.user_id ? 'WHERE u.id = $1' : ''}
       ORDER BY u.id ASC`,
      query.user_id ? [query.user_id] : []
    );

    res.json({ data: rows.rows });
  } catch (err) {
    next(err);
  }
});

// Super admin: credit/debit a wallet (manual adjustment)
/**
 * @swagger
 * /api/wallet/adjust:
 *   post:
 *     summary: Adjust a user's wallet balance (credit or debit)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, amount_paise]
 *             properties:
 *               user_id: { type: integer }
 *               amount_paise: { type: integer, description: Positive for credit, negative for debit }
 *               currency: { type: string, example: INR }
 *               details: { type: string }
 *     responses:
 *       200: { description: Adjustment applied }
 *       400: { description: Insufficient balance or invalid input }
 */
router.post('/adjust', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  const body = z
    .object({
      user_id: z.coerce.number().int().positive(),
      amount_paise: z.coerce.number().int(), // positive credit, negative debit
      currency: z.string().default('INR'),
      details: z.string().optional(),
    })
    .parse(req.body);
  try {
    await ensureWallet(body.user_id);
    await pool.query('BEGIN');

    const balRes = await pool.query('SELECT balance_paise FROM wallet_accounts WHERE user_id = $1 FOR UPDATE', [body.user_id]);
    const current = balRes.rows[0]?.balance_paise ?? 0;
    const nextBal = current + body.amount_paise;
    if (nextBal < 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    await pool.query('UPDATE wallet_accounts SET balance_paise = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [nextBal, body.user_id]);
    const txId = `WL${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
    await pool.query(
      `INSERT INTO wallet_transactions (user_id, transaction_id, type, status, amount_paise, currency, details, balance_after_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        body.user_id,
        txId,
        body.amount_paise >= 0 ? 'ADJUSTMENT' : 'ADJUSTMENT',
        'completed',
        Math.abs(body.amount_paise),
        body.currency,
        body.details ?? (body.amount_paise >= 0 ? 'Credit' : 'Debit'),
        nextBal,
      ]
    );

    await pool.query('COMMIT');
    res.json({ success: true, data: { user_id: body.user_id, balance_paise: nextBal } });
  } catch (err) {
    await pool.query('ROLLBACK');
    next(err);
  }
});

/**
 * @swagger
 * /api/wallet/recharge:
 *   post:
 *     summary: Recharge wallet balance for current user (mocked payment)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount_paise]
 *             properties:
 *               amount_paise: { type: integer }
 *               currency: { type: string, example: INR }
 *               reference: { type: string }
 *     responses:
 *       200: { description: Recharged }
 */
router.post('/recharge', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user?.userId!;
    const body = z.object({ amount_paise: z.coerce.number().int().positive(), currency: z.string().default('INR'), reference: z.string().optional() }).parse(req.body);
    await ensureWallet(userId);
    await pool.query('BEGIN');
    const balRes = await pool.query('SELECT balance_paise FROM wallet_accounts WHERE user_id = $1 FOR UPDATE', [userId]);
    const current = balRes.rows[0]?.balance_paise ?? 0;
    const nextBal = current + body.amount_paise;
    await pool.query('UPDATE wallet_accounts SET balance_paise = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [nextBal, userId]);
    const txId = `RC-${Date.now().toString(36)}`;
    const insTx = await pool.query(
      `INSERT INTO wallet_transactions (user_id, transaction_id, type, status, amount_paise, currency, details, balance_after_paise)
       VALUES ($1,$2,'RECHARGE','completed',$3,$4,$5,$6) RETURNING id`,
      [userId, txId, body.amount_paise, body.currency, body.reference || 'Wallet recharge', nextBal]
    );
    await pool.query('COMMIT');
    res.json({ success: true, data: { wallet_tx_id: insTx.rows[0].id, balance_paise: nextBal } });
  } catch (err) {
    await pool.query('ROLLBACK');
    next(err);
  }
});

export default router;


