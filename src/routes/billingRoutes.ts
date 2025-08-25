import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken, requireSuperAdmin } from '../middleware/authMiddleware';
import { pool } from '../config/database';
import { format } from 'node:util';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Billing
 *   description: Billing plans and conversation billing logs
 */

// Debug endpoint to check current user
router.get('/debug/user', authenticateToken, async (req, res) => {
  try {
    res.json({
      user: req.user,
      message: 'Current user info'
    });
  } catch (err) {
    res.status(500).json({ error: 'Debug failed' });
  }
});

// Debug endpoint to seed billing logs for current user
router.post('/debug/seed-logs', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'User ID not found' });
    }

    // Sample billing logs data for current user
    const sampleLogs = [
      {
        conversation_id: `wamid.${Date.now()}_1`,
        user_id: userId,
        category: 'utility',
        recipient_number: '919373355199',
        start_time: '2025-08-18 18:34:00',
        end_time: '2025-08-18 18:34:00',
        billing_status: 'paid',
        amount_paise: 115,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      },
      {
        conversation_id: `wamid.${Date.now()}_2`,
        user_id: userId,
        category: 'marketing',
        recipient_number: '919876543210',
        start_time: '2025-08-18 19:15:00',
        end_time: '2025-08-18 19:20:00',
        billing_status: 'pending',
        amount_paise: 500,
        amount_currency: 'INR',
        country_code: '+91',
        country_name: 'India'
      }
    ];

    for (const log of sampleLogs) {
      await pool.query(`
        INSERT INTO billing_logs (
          conversation_id, user_id, category, recipient_number, 
          start_time, end_time, billing_status, amount_paise, 
          amount_currency, country_code, country_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (conversation_id) DO NOTHING
      `, [
        log.conversation_id, log.user_id, log.category, log.recipient_number,
        log.start_time, log.end_time, log.billing_status, log.amount_paise,
        log.amount_currency, log.country_code, log.country_name
      ]);
    }

    res.json({ 
      message: 'Billing logs seeded successfully for current user',
      userId: userId,
      logsAdded: sampleLogs.length
    });
  } catch (err) {
    console.error('Error seeding logs:', err);
    res.status(500).json({ error: 'Failed to seed logs' });
  }
});

// Super admin: get all price plans
/**
 * @swagger
 * /api/billing/plans:
 *   get:
 *     summary: List price plans (super admin)
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of price plans
 */
router.get('/plans', authenticateToken, requireSuperAdmin, async (_req, res, next) => {
  try {
    const plans = await pool.query('SELECT * FROM price_plans ORDER BY id ASC');
    res.json({ data: plans.rows });
  } catch (err) {
    next(err);
  }
});

// Super admin: create a plan
/**
 * @swagger
 * /api/billing/plans:
 *   post:
 *     summary: Create a new price plan (super admin)
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               currency: { type: string, example: INR }
 *               utility_paise: { type: integer }
 *               marketing_paise: { type: integer }
 *               authentication_paise: { type: integer }
 *               service_paise: { type: integer }
 *               is_default: { type: boolean }
 *     responses:
 *       201: { description: Created }
 */
router.post('/plans', authenticateToken, async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      currency: z.string().default('INR'),
      utility_paise: z.coerce
        .number()
        .nonnegative()
        .transform((v) => (v < 10 ? Math.round(v * 100) : Math.round(v))),
      marketing_paise: z.coerce
        .number()
        .nonnegative()
        .transform((v) => (v < 10 ? Math.round(v * 100) : Math.round(v))),
      authentication_paise: z.coerce
        .number()
        .nonnegative()
        .transform((v) => (v < 10 ? Math.round(v * 100) : Math.round(v))),
      service_paise: z.coerce
        .number()
        .nonnegative()
        .transform((v) => (v < 10 ? Math.round(v * 100) : Math.round(v)))
        .default(0),
      is_default: z.boolean().default(false),
    }).parse(req.body);
    
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const requester = req.user;

    // Aggregators can create non-default plans only, with floor at their assigned base plan
    if (requester.role === 'aggregator') {
      // Force non-default
      const payload = { ...body, is_default: false };

      // Fetch aggregator's assigned base plan
      const basePlanRes = await pool.query(
        `SELECT pp.*
         FROM user_price_plans upp
         JOIN price_plans pp ON pp.id = upp.price_plan_id
         WHERE upp.user_id = $1
         ORDER BY upp.effective_from DESC
         LIMIT 1`,
        [requester.userId]
      );

      const base = basePlanRes.rows[0];
      if (!base) {
        return res.status(400).json({ success: false, message: 'No base plan assigned to your account' });
      }

      // Enforce floor pricing
      if (
        payload.utility_paise < base.utility_paise ||
        payload.marketing_paise < base.marketing_paise ||
        payload.authentication_paise < base.authentication_paise ||
        payload.service_paise < base.service_paise
      ) {
        return res.status(400).json({ success: false, message: 'Prices cannot be below your base plan minimums' });
      }

      const result = await pool.query(
        `INSERT INTO price_plans (name, currency, utility_paise, marketing_paise, authentication_paise, service_paise, is_default, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          payload.name,
          payload.currency,
          payload.utility_paise,
          payload.marketing_paise,
          payload.authentication_paise,
          payload.service_paise,
          false,
          requester.userId,
        ]
      );
      return res.status(201).json({ data: result.rows[0] });
    }

    // Only super_admin can create (and optionally set default)
    if (requester.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    if (body.is_default) {
      await pool.query('UPDATE price_plans SET is_default = FALSE WHERE is_default = TRUE');
    }

    const result = await pool.query(
      `INSERT INTO price_plans (name, currency, utility_paise, marketing_paise, authentication_paise, service_paise, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        body.name,
        body.currency,
        body.utility_paise,
        body.marketing_paise,
        body.authentication_paise,
        body.service_paise,
        body.is_default,
      ]
    );
    return res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// Super admin: update a plan
/**
 * @swagger
 * /api/billing/plans/{id}:
 *   put:
 *     summary: Update a price plan (super admin)
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               currency: { type: string }
 *               utility_paise: { type: integer }
 *               marketing_paise: { type: integer }
 *               authentication_paise: { type: integer }
 *               service_paise: { type: integer }
 *               is_default: { type: boolean }
 *     responses:
 *       200: { description: Updated }
 */
router.put('/plans/:id', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).optional(),
      currency: z.string().optional(),
      utility_paise: z
        .coerce.number()
        .nonnegative()
        .transform((v) => (v < 10 ? Math.round(v * 100) : Math.round(v)))
        .optional(),
      marketing_paise: z
        .coerce.number()
        .nonnegative()
        .transform((v) => (v < 10 ? Math.round(v * 100) : Math.round(v)))
        .optional(),
      authentication_paise: z
        .coerce.number()
        .nonnegative()
        .transform((v) => (v < 10 ? Math.round(v * 100) : Math.round(v)))
        .optional(),
      service_paise: z
        .coerce.number()
        .nonnegative()
        .transform((v) => (v < 10 ? Math.round(v * 100) : Math.round(v)))
        .optional(),
      is_default: z.boolean().optional(),
    }).parse(req.body);

    if (body.is_default === true) {
      await pool.query('UPDATE price_plans SET is_default = FALSE WHERE is_default = TRUE');
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const [k, v] of Object.entries(body)) {
      fields.push(`${k} = $${idx++}`);
      values.push(v);
    }
    values.push(id);

    const result = await pool.query(
      `UPDATE price_plans SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// Super admin: set default plan
/**
 * @swagger
 * /api/billing/plans/{id}/default:
 *   post:
 *     summary: Set plan as default (super admin)
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Default set }
 */
router.post('/plans/:id/default', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    await pool.query('UPDATE price_plans SET is_default = FALSE WHERE is_default = TRUE');
    const result = await pool.query('UPDATE price_plans SET is_default = TRUE WHERE id = $1 RETURNING *', [id]);
    res.json({ data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/billing/users/{userId}/plan:
 *   post:
 *     summary: Assign a price plan to a user (super admin)
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [price_plan_id]
 *             properties:
 *               price_plan_id: { type: integer }
 *               effective_from: { type: string, format: date-time }
 *     responses:
 *       200: { description: Plan assignment created }
 */
router.post('/users/:userId/plan', authenticateToken, async (req, res, next) => {
  try {
    const { userId } = z.object({ userId: z.coerce.number().int().positive() }).parse(req.params);
    const body = z.object({
      price_plan_id: z.coerce.number().int().positive(),
      effective_from: z.string().optional(),
    }).parse(req.body);

    // Authorization: super_admin, or aggregator managing this user
    const requester = req.user!;
    let isAllowed = false;
    if (requester.role === 'super_admin') {
      isAllowed = true;
    } else if (requester.role === 'aggregator') {
      const managed = await pool.query(
        'SELECT 1 FROM user_children WHERE parent_user_id = $1 AND child_user_id = $2 LIMIT 1',
        [requester.userId, userId]
      );
      const managedCount = managed?.rowCount ?? 0;
      isAllowed = managedCount > 0;
    }
    if (!isAllowed) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    // ensure plan exists
    const planRes = await pool.query('SELECT id FROM price_plans WHERE id = $1', [body.price_plan_id]);
    if (!planRes.rows[0]) {
      return res.status(404).json({ success: false, message: 'Price plan not found' });
    }

    const eff = body.effective_from ? new Date(body.effective_from) : new Date();
    const ins = await pool.query(
      `INSERT INTO user_price_plans (user_id, price_plan_id, effective_from)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [userId, body.price_plan_id, eff]
    );

    res.json({ success: true, data: ins.rows[0] });
  } catch (err) {
    next(err);
  }
});

// Aggregator: list my created plans (non-default)
router.get('/my-plans', authenticateToken, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (!['aggregator', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const ownerId = req.user.role === 'super_admin' ? req.user.userId : req.user.userId;
    const plans = await pool.query(
      'SELECT * FROM price_plans WHERE created_by = $1 ORDER BY id ASC',
      [ownerId]
    );
    res.json({ data: plans.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/billing/users/{userId}/plan:
 *   get:
 *     summary: Get current price plan for a user
 *     description: Super admin can fetch any user's plan. A user can fetch their own plan. Aggregators can fetch plans for their managed users.
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Current plan returned }
 *       403: { description: Insufficient permissions }
 */
router.get('/users/:userId/plan', authenticateToken, async (req, res, next) => {
  try {
    const { userId } = z.object({ userId: z.coerce.number().int().positive() }).parse(req.params);

    // Authorization: allow if requester is super_admin, the same user, or an aggregator managing the user
    const requester = req.user!;
    let isAllowed = false;

    if (requester.role === 'super_admin') {
      isAllowed = true;
    } else if (requester.userId === userId) {
      isAllowed = true;
    } else if (requester.role === 'aggregator') {
      try {
        const managed = await pool.query(
          'SELECT 1 FROM user_children WHERE parent_user_id = $1 AND child_user_id = $2 LIMIT 1',
          [requester.userId, userId]
        );
        const managedCount = managed?.rowCount ?? 0;
        isAllowed = managedCount > 0;
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Database error while checking permissions' });
      }
    }

    if (!isAllowed) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const result = await pool.query(
      `SELECT pp.*
       FROM user_price_plans upp
       JOIN price_plans pp ON pp.id = upp.price_plan_id
       WHERE upp.user_id = $1
       ORDER BY upp.effective_from DESC
       LIMIT 1`,
      [userId]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    next(err);
  }
});

// Get billing logs for current user (user or aggregator)
/**
 * @swagger
 * /api/billing/logs:
 *   get:
 *     summary: Get billing logs for current user
 *     tags: [Billing]
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
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [utility, marketing, service, authentication] }
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: billing_status
 *         schema: { type: string, enum: [pending, paid, failed] }
 *     responses:
 *       200:
 *         description: Paginated logs with statistics
 */
router.get('/logs', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;
    
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'User ID not found in token' 
      });
    }
    
    console.log('User ID:', userId, 'User Role:', userRole);
    
    // Parse query parameters
    const query = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
      search: z.string().optional(),
      category: z.enum(['utility', 'marketing', 'service', 'authentication']).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      billing_status: z.enum(['pending', 'paid', 'failed']).optional(),
    }).parse(req.query);

    let whereClause = 'WHERE bl.user_id = $1';
    const params: any[] = [userId];
    let paramIndex = 2;

    // Add search filter
    if (query.search) {
      whereClause += ` AND (bl.conversation_id ILIKE $${paramIndex} OR bl.recipient_number ILIKE $${paramIndex} OR bl.country_name ILIKE $${paramIndex})`;
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    // Add category filter
    if (query.category) {
      whereClause += ` AND bl.category = $${paramIndex}`;
      params.push(query.category);
      paramIndex++;
    }

    // Add date range filter
    if (query.start_date) {
      whereClause += ` AND bl.start_time >= $${paramIndex}`;
      params.push(query.start_date);
      paramIndex++;
    }

    if (query.end_date) {
      whereClause += ` AND bl.start_time <= $${paramIndex}`;
      params.push(query.end_date);
      paramIndex++;
    }

    // Add billing status filter
    if (query.billing_status) {
      whereClause += ` AND bl.billing_status = $${paramIndex}`;
      params.push(query.billing_status);
      paramIndex++;
    }

    // Check if billing_logs table exists first
    try {
      const tableExists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'billing_logs'
        );
      `);
      
      if (!tableExists.rows[0].exists) {
        console.log('Billing logs table does not exist, returning empty response');
        return res.json({
          data: {
            logs: [],
            pagination: {
              page: query.page,
              limit: query.limit,
              total: 0,
              pages: 0
            },
            statistics: {
              utility: { count: 0, amount: 0 },
              marketing: { count: 0, amount: 0 },
              service: { count: 0, amount: 0 },
              authentication: { count: 0, amount: 0 }
            }
          }
        });
      }
    } catch (tableCheckError) {
      console.error('Error checking if billing_logs table exists:', tableCheckError);
      return res.status(500).json({
        success: false,
        message: 'Database error while checking table existence'
      });
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM billing_logs bl ${whereClause}`;
    console.log('Count query:', countQuery, 'Params:', params);
    const countResult = await pool.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);
    console.log('Total count:', totalCount);
    
    // Debug: Check if billing_logs table exists and has any data
    const tableCheck = await pool.query('SELECT COUNT(*) as total FROM billing_logs');
    console.log('Total records in billing_logs table:', tableCheck.rows[0].total);
    
    // Debug: Check what users exist
    const usersCheck = await pool.query('SELECT id, name, email FROM users_whatsapp LIMIT 5');
    console.log('Available users:', usersCheck.rows);

    // Get paginated results
    const offset = (query.page - 1) * query.limit;
    const logsQuery = `
      SELECT 
        bl.id,
        bl.conversation_id,
        bl.category,
        bl.recipient_number,
        bl.start_time,
        bl.end_time,
        bl.billing_status,
        bl.amount_paise,
        bl.amount_currency,
        bl.country_code,
        bl.country_name,
        bl.created_at
      FROM billing_logs bl 
      ${whereClause}
      ORDER BY bl.start_time DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    params.push(query.limit, offset);
    
    let logsResult;
    let statsResult;
    
    try {
      logsResult = await pool.query(logsQuery, params);

      // Get billing statistics by category
      const statsQuery = `
        SELECT 
          bl.category,
          COUNT(*) as conversation_count,
          SUM(bl.amount_paise) as total_amount_paise
        FROM billing_logs bl 
        WHERE bl.user_id = $1
        GROUP BY bl.category
      `;
      statsResult = await pool.query(statsQuery, [userId]);
    } catch (queryError) {
      console.error('Error executing billing queries:', queryError);
      return res.status(500).json({
        success: false,
        message: 'Database error while fetching billing data'
      });
    }

    const stats = {
      utility: { count: 0, amount: 0 },
      marketing: { count: 0, amount: 0 },
      service: { count: 0, amount: 0 },
      authentication: { count: 0, amount: 0 }
    };

    statsResult.rows.forEach((row: any) => {
      stats[row.category as keyof typeof stats] = {
        count: parseInt(row.conversation_count),
        amount: parseInt(row.total_amount_paise)
      };
    });

    res.json({
      data: {
        logs: logsResult.rows,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: totalCount,
          pages: Math.ceil(totalCount / query.limit)
        },
        statistics: stats
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/billing/logs/export:
 *   get:
 *     summary: Export billing logs for current user as CSV
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [utility, marketing, service, authentication] }
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: billing_status
 *         schema: { type: string, enum: [pending, paid, failed] }
 *     responses:
 *       200:
 *         description: CSV file
 */
router.get('/logs/export', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).end();

    const query = z.object({
      search: z.string().optional(),
      category: z.enum(['utility', 'marketing', 'service', 'authentication']).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      billing_status: z.enum(['pending', 'paid', 'failed']).optional(),
    }).parse(req.query);

    let where = 'WHERE bl.user_id = $1';
    const params: any[] = [userId];
    let i = 2;
    if (query.search) { where += ` AND (bl.conversation_id ILIKE $${i} OR bl.recipient_number ILIKE $${i} OR bl.country_name ILIKE $${i})`; params.push(`%${query.search}%`); i++; }
    if (query.category) { where += ` AND bl.category = $${i}`; params.push(query.category); i++; }
    if (query.start_date) { where += ` AND bl.start_time >= $${i}`; params.push(query.start_date); i++; }
    if (query.end_date) { where += ` AND bl.start_time <= $${i}`; params.push(query.end_date); i++; }
    if (query.billing_status) { where += ` AND bl.billing_status = $${i}`; params.push(query.billing_status); i++; }

    const rows = await pool.query(
      `SELECT bl.conversation_id, bl.category, bl.recipient_number, bl.start_time, bl.end_time, bl.billing_status, bl.amount_paise, bl.amount_currency, bl.country_name
       FROM billing_logs bl
       ${where}
       ORDER BY bl.start_time DESC`,
      params
    );

    const header = 'conversation_id,category,recipient_number,start_time,end_time,billing_status,amount,currency,country\n';
    const csv = rows.rows.map(r => [
      r.conversation_id,
      r.category,
      r.recipient_number,
      new Date(r.start_time).toISOString(),
      new Date(r.end_time).toISOString(),
      r.billing_status,
      (r.amount_paise/100).toFixed(3),
      r.amount_currency,
      r.country_name || ''
    ].map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="billing_logs_${userId}.csv"`);
    res.status(200).send(header + csv + '\n');
  } catch (err) {
    next(err);
  }
});

// Get billing logs for all users (super admin only)
/**
 * @swagger
 * /api/billing/logs/all:
 *   get:
 *     summary: Get billing logs for all users (super admin)
 *     tags: [Billing]
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
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: user_id
 *         schema: { type: integer }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [utility, marketing, service, authentication] }
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: billing_status
 *         schema: { type: string, enum: [pending, paid, failed] }
 *     responses:
 *       200:
 *         description: Paginated logs with statistics across users
 */
router.get('/logs/all', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;
    
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'User ID not found in token' 
      });
    }
    
    const query = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
      search: z.string().optional(),
      category: z.enum(['utility', 'marketing', 'service', 'authentication']).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      billing_status: z.enum(['pending', 'paid', 'failed']).optional(),
      user_id: z.coerce.number().int().positive().optional(),
    }).parse(req.query);

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // Add search filter
    if (query.search) {
      whereClause += ` AND (bl.conversation_id ILIKE $${paramIndex} OR bl.recipient_number ILIKE $${paramIndex} OR bl.country_name ILIKE $${paramIndex})`;
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    // Add category filter
    if (query.category) {
      whereClause += ` AND bl.category = $${paramIndex}`;
      params.push(query.category);
      paramIndex++;
    }

    // Add date range filter
    if (query.start_date) {
      whereClause += ` AND bl.start_time >= $${paramIndex}`;
      params.push(query.start_date);
      paramIndex++;
    }

    if (query.end_date) {
      whereClause += ` AND bl.start_time <= $${paramIndex}`;
      params.push(query.end_date);
      paramIndex++;
    }

    // Add billing status filter
    if (query.billing_status) {
      whereClause += ` AND bl.billing_status = $${paramIndex}`;
      params.push(query.billing_status);
      paramIndex++;
    }

    // Add user filter
    if (query.user_id) {
      whereClause += ` AND bl.user_id = $${paramIndex}`;
      params.push(query.user_id);
      paramIndex++;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM billing_logs bl ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);

    // Get paginated results with user information
    const offset = (query.page - 1) * query.limit;
    const logsQuery = `
      SELECT 
        bl.id,
        bl.conversation_id,
        bl.category,
        bl.recipient_number,
        bl.start_time,
        bl.end_time,
        bl.billing_status,
        bl.amount_paise,
        bl.amount_currency,
        bl.country_code,
        bl.country_name,
        bl.created_at,
        u.name as user_name,
        u.email as user_email,
        u.role as user_role
      FROM billing_logs bl 
      LEFT JOIN users_whatsapp u ON bl.user_id = u.id
      ${whereClause}
      ORDER BY bl.start_time DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    params.push(query.limit, offset);
    const logsResult = await pool.query(logsQuery, params);

    // Get overall billing statistics
    const statsQuery = `
      SELECT 
        bl.category,
        COUNT(*) as conversation_count,
        SUM(bl.amount_paise) as total_amount_paise
      FROM billing_logs bl 
      ${whereClause}
      GROUP BY bl.category
    `;
    const statsResult = await pool.query(statsQuery, params.slice(0, -2)); // Remove limit and offset

    const stats = {
      utility: { count: 0, amount: 0 },
      marketing: { count: 0, amount: 0 },
      service: { count: 0, amount: 0 },
      authentication: { count: 0, amount: 0 }
    };

    statsResult.rows.forEach((row: any) => {
      stats[row.category as keyof typeof stats] = {
        count: parseInt(row.conversation_count),
        amount: parseInt(row.total_amount_paise)
      };
    });

    res.json({
      data: {
        logs: logsResult.rows,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: totalCount,
          pages: Math.ceil(totalCount / query.limit)
        },
        statistics: stats
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/billing/managed/logs:
 *   get:
 *     summary: Get billing logs for users managed by an aggregator
 *     tags: [Billing]
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
 *         name: user_id
 *         schema: { type: integer }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [utility, marketing, service, authentication] }
 *     responses:
 *       200: { description: Paginated logs for managed users }
 */
router.get('/managed/logs', authenticateToken, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).end();
    if (!['aggregator', 'super_admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Admin access required' });
    const q = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20), user_id: z.coerce.number().int().positive().optional(), category: z.enum(['utility','marketing','service','authentication']).optional() }).parse(req.query);
    // get managed children
    const children = await pool.query('SELECT child_user_id FROM user_children WHERE parent_user_id = $1', [req.user.userId]);
    const ids = children.rows.map((r: any) => r.child_user_id);
    if (req.user.role === 'super_admin' && q.user_id && !ids.includes(q.user_id)) ids.push(q.user_id);
    if (ids.length === 0) return res.json({ data: { logs: [], pagination: { page: q.page, limit: q.limit, total: 0, pages: 0 } } });
    const params: any[] = [ids];
    let where = 'WHERE bl.user_id = ANY($1)';
    if (q.category) { where += ' AND bl.category = $2'; params.push(q.category); }
    const count = await pool.query(`SELECT COUNT(*) FROM billing_logs bl ${where}`, params);
    const total = parseInt(count.rows[0].count);
    const offset = (q.page - 1) * q.limit;
    const logs = await pool.query(`SELECT bl.* FROM billing_logs bl ${where} ORDER BY bl.start_time DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, q.limit, offset]);
    res.json({ data: { logs: logs.rows, pagination: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } } });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/billing/logs/all/export:
 *   get:
 *     summary: Export billing logs for all users as CSV (super admin)
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [utility, marketing, service, authentication] }
 *       - in: query
 *         name: start_date
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: end_date
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: billing_status
 *         schema: { type: string, enum: [pending, paid, failed] }
 *     responses:
 *       200:
 *         description: CSV file
 */
router.get('/logs/all/export', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const query = z.object({
      user_id: z.coerce.number().int().positive().optional(),
      search: z.string().optional(),
      category: z.enum(['utility', 'marketing', 'service', 'authentication']).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      billing_status: z.enum(['pending', 'paid', 'failed']).optional(),
    }).parse(req.query);

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let i = 1;
    if (query.user_id) { where += ` AND bl.user_id = $${i}`; params.push(query.user_id); i++; }
    if (query.search) { where += ` AND (bl.conversation_id ILIKE $${i} OR bl.recipient_number ILIKE $${i} OR bl.country_name ILIKE $${i})`; params.push(`%${query.search}%`); i++; }
    if (query.category) { where += ` AND bl.category = $${i}`; params.push(query.category); i++; }
    if (query.start_date) { where += ` AND bl.start_time >= $${i}`; params.push(query.start_date); i++; }
    if (query.end_date) { where += ` AND bl.start_time <= $${i}`; params.push(query.end_date); i++; }
    if (query.billing_status) { where += ` AND bl.billing_status = $${i}`; params.push(query.billing_status); i++; }

    const rows = await pool.query(
      `SELECT bl.user_id, bl.conversation_id, bl.category, bl.recipient_number, bl.start_time, bl.end_time, bl.billing_status, bl.amount_paise, bl.amount_currency, bl.country_name
       FROM billing_logs bl
       ${where}
       ORDER BY bl.start_time DESC`,
      params
    );

    const header = 'user_id,conversation_id,category,recipient_number,start_time,end_time,billing_status,amount,currency,country\n';
    const csv = rows.rows.map(r => [
      r.user_id,
      r.conversation_id,
      r.category,
      r.recipient_number,
      new Date(r.start_time).toISOString(),
      new Date(r.end_time).toISOString(),
      r.billing_status,
      (r.amount_paise/100).toFixed(3),
      r.amount_currency,
      r.country_name || ''
    ].map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="billing_logs_all.csv"`);
    res.status(200).send(header + csv + '\n');
  } catch (err) {
    next(err);
  }
});

export default router;
