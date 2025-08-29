import { Router } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/authMiddleware';
import { pool } from '../config/database';
import { interaktClient } from '../services/interaktClient';
import { env } from '../config/env';

const router = Router();

// Validation schemas
const embeddedSignupSchema = z.object({
  phone_number_id: z.string(),
  waba_id: z.string(),
  business_id: z.string()
});

const exchangeTokenSchema = z.object({
  code: z.string().optional(),
  business_token: z.string().optional(),
  redirect_uri: z.string().optional()
}).refine((d) => !!(d.code || d.business_token), { message: 'Provide either code or business_token' });

const tpSignupSchema = z.object({
  waba_id: z.string(),
  phone_number_id: z.string().optional(),
  solution_id: z.string().optional(),
  phone_number: z.string().optional()
});

const setupTemplatesSchema = z.object({
  waba_id: z.string()
});

const testMessageSchema = z.object({
  waba_id: z.string(),
  phone_number_id: z.string()
});

const registerNumberSchema = z.object({
  waba_id: z.string().optional(),
  phone_number_id: z.string().optional(),
  pin: z.string().regex(/^\d{6}$/)
});

/**
 * @swagger
 * /api/whatsapp/embedded-signup:
 *   post:
 *     summary: Save embedded signup data
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone_number_id
 *               - waba_id
 *               - business_id
 *             properties:
 *               phone_number_id:
 *                 type: string
 *               waba_id:
 *                 type: string
 *               business_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Setup data saved successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/embedded-signup', authenticateToken, async (req, res) => {
  try {
    const validatedData = embeddedSignupSchema.parse(req.body);
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Check if user already has WhatsApp setup
    const existingSetup = await pool.query(
      'SELECT id FROM whatsapp_setups WHERE user_id = $1',
      [userId]
    );

    if (existingSetup.rows.length > 0) {
      // Update existing setup
      await pool.query(`
        UPDATE whatsapp_setups 
        SET phone_number_id = $1, waba_id = $2, business_id = $3, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $4
      `, [validatedData.phone_number_id, validatedData.waba_id, validatedData.business_id, userId]);
    } else {
      // Create new setup
      await pool.query(`
        INSERT INTO whatsapp_setups (user_id, phone_number_id, waba_id, business_id, status)
        VALUES ($1, $2, $3, $4, 'embedded_signup_completed')
      `, [userId, validatedData.phone_number_id, validatedData.waba_id, validatedData.business_id]);
    }

    res.json({
      success: true,
      message: 'Embedded signup data saved successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    console.error('Error saving embedded signup data:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/whatsapp/exchange-token:
 *   post:
 *     summary: Exchange token code for business token
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token exchanged successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/exchange-token', authenticateToken, async (req, res) => {
  try {
    const validatedData = exchangeTokenSchema.parse(req.body);
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Exchange code for business token and persist
    try {
      let businessToken = validatedData.business_token;
      if (!businessToken) {
        const appId = env.APP_ID || '2524533311265577';
        const appSecret = env.APP_SECRET;
        if (!appSecret) {
          return res.status(500).json({ success: false, message: 'Server missing APP_SECRET for token exchange' });
        }
        if (!validatedData.code) {
          return res.status(400).json({ success: false, message: 'Missing code for token exchange' });
        }
        const exchange = await interaktClient.exchangeCodeForBusinessToken({ appId, appSecret, code: validatedData.code, redirectUri: validatedData.redirect_uri });
        businessToken = exchange?.access_token;
      }
      if (!businessToken) {
        return res.status(502).json({ success: false, message: 'Failed to exchange code for business token' });
      }
      await pool.query(`
        UPDATE whatsapp_setups
        SET business_token = $1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2
      `, [businessToken, userId]);
      res.json({ success: true, message: 'Token exchanged successfully' });
    } catch (e) {
      console.error('Error exchanging code for business token:', e);
      return res.status(502).json({ success: false, message: 'Token exchange failed', error: (e as any)?.response?.data || (e as Error).message });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    console.error('Error exchanging token:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/whatsapp/tp-signup:
 *   post:
 *     summary: Complete TP signup with Interakt
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - waba_id
 *               - phone_number_id
 *             properties:
 *               waba_id:
 *                 type: string
 *               phone_number_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: TP signup completed successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/tp-signup', authenticateToken, async (req, res) => {
  try {
    const validatedData = tpSignupSchema.parse(req.body);
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Update WhatsApp setup status
    await pool.query(`
      UPDATE whatsapp_setups 
      SET status = 'tp_signup_completed', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
    `, [userId]);

    // Call Interakt Tech Partner Onboarding API
    try {
      const solutionId = validatedData.solution_id || env.INTERAKT_SOLUTION_ID;
      if (!solutionId || solutionId === 'dev_solution_id') {
        return res.status(400).json({ success: false, message: 'solution_id is required (set INTERAKT_SOLUTION_ID in env or pass in body).' });
      }
      const response = await interaktClient.techPartnerSignup({
        waba_id: validatedData.waba_id,
        solution_id: solutionId,
        phone_number: validatedData.phone_number
      });
      console.log('Interakt TP signup response:', response);
    } catch (e) {
      console.error('Interakt TP signup failed:', e);
      return res.status(502).json({ success: false, message: 'Interakt TP signup failed', error: (e as any)?.response?.data || (e as Error).message });
    }

    res.json({
      success: true,
      message: 'TP signup completed successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    console.error('Error completing TP signup:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/whatsapp/setup-templates:
 *   post:
 *     summary: Setup message templates
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - waba_id
 *             properties:
 *               waba_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Templates setup completed
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/setup-templates', authenticateToken, async (req, res) => {
  try {
    const validatedData = setupTemplatesSchema.parse(req.body);
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Update WhatsApp setup status
    await pool.query(`
      UPDATE whatsapp_setups 
      SET status = 'templates_setup_completed', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
    `, [userId]);

    // TODO: Implement actual template setup with Meta API
    console.log('Templates setup completed for user:', userId, 'with WABA:', validatedData.waba_id);

    res.json({
      success: true,
      message: 'Templates setup completed successfully'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    console.error('Error setting up templates:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * @swagger
 * /api/whatsapp/send-test-message:
 *   post:
 *     summary: Send test message to verify setup
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - waba_id
 *               - phone_number_id
 *             properties:
 *               waba_id:
 *                 type: string
 *               phone_number_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Test message sent successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post('/send-test-message', authenticateToken, async (req, res) => {
  try {
    const validatedData = testMessageSchema.parse(req.body);
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Load business token and phone number from DB
    const setup = await pool.query('SELECT business_token, phone_number_id FROM whatsapp_setups WHERE user_id = $1', [userId]);
    const businessToken: string | null = setup.rows?.[0]?.business_token || null;
    const phoneNumberId: string = (validatedData.phone_number_id || setup.rows?.[0]?.phone_number_id);
    if (!businessToken) {
      return res.status(400).json({ success: false, message: 'Business token not found. Exchange token first.' });
    }
    if (!phoneNumberId) {
      return res.status(400).json({ success: false, message: 'Phone number ID not found.' });
    }

    // Optionally subscribe app to WABA (best effort)
    try {
      if (validatedData.waba_id) {
        await interaktClient.subscribeAppToWaba({ wabaId: validatedData.waba_id, businessToken });
      }
    } catch {}

    // Send a text message if client provided destination
    const to = (req.body as any)?.to as string | undefined;
    const body = (req.body as any)?.text as string | undefined;
    const templateName = (req.body as any)?.template_name as string | undefined;
    const languageCode = (req.body as any)?.language_code as string | undefined;
    if (to && body) {
      try {
        const textRes = await interaktClient.sendTextMessageWithBusinessToken({ phoneNumberId, businessToken, to, body });
        console.log('Text message response:', textRes);
      } catch (e) {
        // Fallback to template if 24-hour session not open
        try {
          const tpl = await interaktClient.sendTemplateMessageWithBusinessToken({
            phoneNumberId,
            businessToken,
            to,
            templateName: templateName || 'hello_world',
            languageCode: languageCode || 'en_US',
          });
          console.log('Template message response:', tpl);
        } catch (e2) {
          return res.status(502).json({ success: false, message: 'Failed to send message (text and template fallback failed)', error: (e2 as any)?.response?.data || (e2 as Error).message });
        }
      }
    }

    // Mark setup as completed
    await pool.query(`
      UPDATE whatsapp_setups 
      SET status = 'setup_completed', updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
    `, [userId]);

    res.json({ success: true, message: 'Test message processed. Setup completed!' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.issues
      });
    }
    
    console.error('Error sending test message:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Register customer's phone number with a 6-digit PIN (Step 4)
router.post('/register-number', authenticateToken, async (req, res) => {
  try {
    const { waba_id, phone_number_id, pin } = registerNumberSchema.parse(req.body);
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const setup = await pool.query('SELECT business_token, phone_number_id, waba_id FROM whatsapp_setups WHERE user_id = $1', [userId]);
    const businessToken: string | null = setup.rows?.[0]?.business_token || null;
    const pnId = phone_number_id || setup.rows?.[0]?.phone_number_id;
    const wabaId = waba_id || setup.rows?.[0]?.waba_id;
    if (!businessToken) return res.status(400).json({ success: false, message: 'Business token not found. Run token exchange first.' });
    if (!pnId) return res.status(400).json({ success: false, message: 'Phone number ID not found.' });

    // Subscribe app to WABA first (best effort)
    if (wabaId) {
      try { await interaktClient.subscribeAppToWaba({ wabaId, businessToken }); } catch {}
    }

    const result = await interaktClient.registerBusinessPhoneNumber({ phoneNumberId: pnId, businessToken, pin });

    res.json({ success: true, message: 'Phone number registration initiated', data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.issues });
    }
    return res.status(500).json({ success: false, message: 'Failed to register number', error: (error as any)?.response?.data || (error as Error).message });
  }
});

/**
 * @swagger
 * /api/whatsapp/setup-status:
 *   get:
 *     summary: Get user's WhatsApp setup status
 *     tags: [WhatsApp]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Setup status retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/setup-status', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const result = await pool.query(`
      SELECT status, phone_number_id, waba_id, business_id, created_at, updated_at
      FROM whatsapp_setups 
      WHERE user_id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          status: 'not_started',
          phone_number_id: null,
          waba_id: null,
          business_id: null
        }
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error getting setup status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;
