import { Router } from "express";
import { z } from "zod";
import { interaktClient } from "../services/interaktClient";
import { withFallback } from "../utils/fallback";
import { env } from "../config/env";
import { authenticateToken } from "../middleware/authMiddleware";
import { pool } from "../config/database";

const router = Router();

// Helper function to get user's WhatsApp setup
async function getUserWhatsAppSetup(userId: number) {
  const result = await pool.query(
    'SELECT waba_id, phone_number_id FROM whatsapp_setups WHERE user_id = $1 AND waba_id IS NOT NULL AND phone_number_id IS NOT NULL',
    [userId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('WhatsApp setup not completed. Please complete WhatsApp Business setup first.');
  }
  
  return result.rows[0];
}

/**
 * @openapi
 * tags:
 *   - name: Account Metrics
 *     description: WhatsApp Business Account analytics and metrics - Message, Conversation, and Template Analytics
 */

/**
 * @openapi
 * /api/acc-matrics/message-analytics:
 *   get:
 *     tags:
 *       - Account Metrics
 *     summary: Get Message Analytics
 *     description: Retrieves message analytics including sent, delivered, and failed message counts for a specific date range and granularity.
 *     parameters:
 *       - in: query
 *         name: start
 *         required: true
 *         schema:
 *           type: integer
 *         description: Start date (Unix timestamp)
 *         example: 1693506600
 *       - in: query
 *         name: end
 *         required: true
 *         schema:
 *           type: integer
 *         description: End date (Unix timestamp)
 *         example: 1706725800
 *       - in: query
 *         name: granularity
 *         required: true
 *         schema:
 *           type: string
 *           enum: [HALF_HOUR, DAY, MONTH]
 *         description: Time granularity for analytics
 *         example: MONTH
 *       - in: query
 *         name: phone_numbers
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Array of phone numbers to filter analytics
 *         example: ["912240289385"]
 *       - in: query
 *         name: product_types
 *         schema:
 *           type: array
 *           items:
 *             type: integer
 *           description: Message types (0=notification, 2=customer support)
 *         example: [0, 2]
 *       - in: query
 *         name: country_codes
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Array of 2-letter country codes
 *         example: ["US", "IN"]
 *     responses:
 *       200:
 *         description: Message analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 analytics:
 *                   type: object
 *                   properties:
 *                     phone_numbers:
 *                       type: array
 *                       items:
 *                         type: string
 *                     granularity:
 *                       type: string
 *                     data_points:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           start:
 *                             type: integer
 *                           end:
 *                             type: integer
 *                           sent:
 *                             type: integer
 *                           delivered:
 *                             type: integer
 *                 id:
 *                   type: string
 *                 fallback:
 *                   type: boolean
 */
// GET /api/acc-matrics/message-analytics
router.get("/message-analytics", authenticateToken, async (req, res, next) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Get user's WhatsApp setup
    const userSetup = await getUserWhatsAppSetup(userId);

    const querySchema = z.object({
      start: z.coerce.number(),
      end: z.coerce.number(),
      granularity: z.enum(["HALF_HOUR", "DAY", "MONTH"]),
      // Accept single value or repeated keys; coerce to array of strings
      phone_numbers: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return [v];
          return v;
        }, z.array(z.string()).optional()),
      // Accept single/repeated values and coerce strings to numbers
      product_types: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          const values = Array.isArray(v) ? v : [v];
          return values.map((x) => (typeof x === "number" ? x : Number(x)));
        }, z.array(z.number()).optional()),
      // Accept single value or repeated keys; coerce to array of strings
      country_codes: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          return Array.isArray(v) ? v : [v as any];
        }, z.array(z.string()).optional()),
    });

    const query = querySchema.parse(req.query);

    // Build the fields query string
    let fields = `analytics.start(${query.start}).end(${query.end}).granularity(${query.granularity})`;
    
    if (query.phone_numbers && query.phone_numbers.length > 0) {
      fields += `.phone_numbers([${query.phone_numbers.map(p => `"${p}"`).join(",")}])`;
    }
    
    if (query.product_types && query.product_types.length > 0) {
      fields += `.product_types([${query.product_types.join(",")}])`;
    }
    
    if (query.country_codes && query.country_codes.length > 0) {
      fields += `.country_codes([${query.country_codes.map(c => `"${c}"`).join(",")}])`;
    }

    const data = await withFallback({
      feature: "getMessageAnalytics",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${userSetup.waba_id}?fields=${encodeURIComponent(fields)}`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': userSetup.waba_id,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Message analytics API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        analytics: {
          phone_numbers: [userSetup.phone_number_id],
          granularity: query.granularity,
          data_points: [
            {
              start: query.start,
              end: query.start + 2592000, // 30 days
              sent: 2497742,
              delivered: 2395663
            },
            {
              start: query.start + 2592000,
              end: query.end,
              sent: 4366872,
              delivered: 4171084
            }
          ]
        },
        id: userSetup.waba_id,
        fallback: true
      })
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/acc-matrics/conversation-analytics:
 *   get:
 *     tags:
 *       - Account Metrics
 *     summary: Get Conversation Analytics
 *     description: Retrieves conversation analytics including cost and conversation information for a specific date range.
 *     parameters:
 *       - in: query
 *         name: start
 *         required: true
 *         schema:
 *           type: integer
 *         description: Start date (Unix timestamp)
 *         example: 1693506600
 *       - in: query
 *         name: end
 *         required: true
 *         schema:
 *           type: integer
 *         description: End date (Unix timestamp)
 *         example: 1706725800
 *       - in: query
 *         name: granularity
 *         required: true
 *         schema:
 *           type: string
 *           enum: [HALF_HOUR, DAILY, MONTHLY]
 *         description: Time granularity for analytics
 *         example: MONTHLY
 *       - in: query
 *         name: phone_numbers
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Array of phone numbers to filter analytics
 *         example: ["912240289385"]
 *       - in: query
 *         name: metric_types
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [COST, CONVERSATION]
 *         description: Types of metrics to retrieve
 *         example: ["CONVERSATION"]
 *       - in: query
 *         name: conversation_categories
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [AUTHENTICATION, MARKETING, SERVICE, UTILITY]
 *         description: Conversation categories to filter
 *         example: ["MARKETING", "SERVICE"]
 *       - in: query
 *         name: conversation_types
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [FREE_ENTRY, FREE_TIER, REGULAR]
 *         description: Conversation types to filter
 *         example: ["REGULAR"]
 *       - in: query
 *         name: conversation_directions
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [BUSINESS_INITIATED, USER_INITIATED]
 *         description: Conversation directions to filter
 *         example: ["BUSINESS_INITIATED"]
 *       - in: query
 *         name: dimensions
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [CONVERSATION_CATEGORY, CONVERSATION_DIRECTION, CONVERSATION_TYPE, COUNTRY, PHONE]
 *         description: Dimensions for breakdown
 *         example: ["CONVERSATION_CATEGORY", "COUNTRY"]
 *     responses:
 *       200:
 *         description: Conversation analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversation_analytics:
 *                   type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           data_points:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 start:
 *                                   type: integer
 *                                 end:
 *                                   type: integer
 *                                 conversation:
 *                                   type: integer
 *                                 phone_number:
 *                                   type: string
 *                                 country:
 *                                   type: string
 *                                 conversation_type:
 *                                   type: string
 *                                 conversation_category:
 *                                   type: string
 *                                 cost:
 *                                   type: number
 *                 id:
 *                   type: string
 *                 fallback:
 *                   type: boolean
 */
// GET /api/acc-matrics/conversation-analytics
router.get("/conversation-analytics", authenticateToken, async (req, res, next) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Get user's WhatsApp setup
    const userSetup = await getUserWhatsAppSetup(userId);

    const querySchema = z.object({
      start: z.coerce.number(),
      end: z.coerce.number(),
      granularity: z.enum(["HALF_HOUR", "DAILY", "MONTHLY"]),
      // Accept single value or repeated keys; coerce to array of strings
      phone_numbers: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return [v];
          return v;
        }, z.array(z.string()).optional()),
      // Accept single value or repeated keys; coerce to array of strings
      metric_types: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return [v];
          return v;
        }, z.array(z.enum(["COST", "CONVERSATION"])).optional()),
      // Accept single value or repeated keys; coerce to array of strings
      conversation_categories: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return [v];
          return v;
        }, z.array(z.enum(["AUTHENTICATION", "MARKETING", "SERVICE", "UTILITY"])).optional()),
      // Accept single value or repeated keys; coerce to array of strings
      conversation_types: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return [v];
          return v;
        }, z.array(z.enum(["FREE_ENTRY", "FREE_TIER", "REGULAR"])).optional()),
      // Accept single value or repeated keys; coerce to array of strings
      conversation_directions: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return [v];
          return v;
        }, z.array(z.enum(["BUSINESS_INITIATED", "USER_INITIATED"])).optional()),
      // Accept single value or repeated keys; coerce to array of strings
      dimensions: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return [v];
          return v;
        }, z.array(z.enum(["CONVERSATION_CATEGORY", "CONVERSATION_DIRECTION", "CONVERSATION_TYPE", "COUNTRY", "PHONE"])).optional()),
    });

    const query = querySchema.parse(req.query);

    // Build the fields query string
    let fields = `conversation_analytics.start(${query.start}).end(${query.end}).granularity(${query.granularity})`;
    
    if (query.phone_numbers && query.phone_numbers.length > 0) {
      fields += `.phone_numbers([${query.phone_numbers.map(p => `"${p}"`).join(",")}])`;
    }
    
    if (query.metric_types && query.metric_types.length > 0) {
      fields += `.metric_types([${query.metric_types.map(m => `"${m}"`).join(",")}])`;
    }
    
    if (query.conversation_categories && query.conversation_categories.length > 0) {
      fields += `.conversation_categories([${query.conversation_categories.map(c => `"${c}"`).join(",")}])`;
    }
    
    if (query.conversation_types && query.conversation_types.length > 0) {
      fields += `.conversation_types([${query.conversation_types.map(t => `"${t}"`).join(",")}])`;
    }
    
    if (query.conversation_directions && query.conversation_directions.length > 0) {
      fields += `.conversation_directions([${query.conversation_directions.map(d => `"${d}"`).join(",")}])`;
    }
    
    if (query.dimensions && query.dimensions.length > 0) {
      fields += `.dimensions([${query.dimensions.map(d => `"${d}"`).join(",")}])`;
    }

    const data = await withFallback({
      feature: "getConversationAnalytics",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${userSetup.waba_id}?fields=${encodeURIComponent(fields)}`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': userSetup.waba_id,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Conversation analytics API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        conversation_analytics: {
          data: [
            {
              data_points: [
                {
                  start: query.start,
                  end: query.start + 2592000,
                  conversation: 1,
                  phone_number: userSetup.phone_number_id,
                  country: "KW",
                  conversation_type: "REGULAR",
                  conversation_category: "MARKETING",
                  cost: 2.4993
                }
              ]
            }
          ]
        },
        id: userSetup.waba_id,
        fallback: true
      })
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/acc-matrics/enable-template-analytics:
 *   post:
 *     tags:
 *       - Account Metrics
 *     summary: Enable Template Analytics
 *     description: Enables template analytics for the WhatsApp Business Account. This must be done before you can retrieve template analytics.
 *     responses:
 *       200:
 *         description: Template analytics enabled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 fallback:
 *                   type: boolean
 */
// POST /api/acc-matrics/enable-template-analytics
router.post("/enable-template-analytics", authenticateToken, async (req, res, next) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Get user's WhatsApp setup
    const userSetup = await getUserWhatsAppSetup(userId);

    const data = await withFallback({
      feature: "enableTemplateAnalytics",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${userSetup.waba_id}?is_enabled_for_insights=true`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': userSetup.waba_id,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Enable template analytics API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        id: userSetup.waba_id,
        fallback: true
      })
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/acc-matrics/template-analytics:
 *   get:
 *     tags:
 *       - Account Metrics
 *     summary: Get Template Analytics
 *     description: Retrieves template analytics including sent, delivered, read, and clicked metrics for specific templates.
 *     parameters:
 *       - in: query
 *         name: start
 *         required: true
 *         schema:
 *           type: integer
 *         description: Start date (Unix timestamp)
 *         example: 1689379200
 *       - in: query
 *         name: end
 *         required: true
 *         schema:
 *           type: integer
 *         description: End date (Unix timestamp)
 *         example: 1689552000
 *       - in: query
 *         name: granularity
 *         required: true
 *         schema:
 *           type: string
 *           enum: [DAILY]
 *         description: Time granularity (only DAILY supported)
 *         example: DAILY
 *       - in: query
 *         name: template_ids
 *         required: true
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Array of template IDs (max 10)
 *         example: ["1924084211297547", "954638012257287"]
 *       - in: query
 *         name: metric_types
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [SENT, DELIVERED, READ, CLICKED]
 *         description: Types of metrics to retrieve
 *         example: ["SENT", "DELIVERED", "READ", "CLICKED"]
 *     responses:
 *       200:
 *         description: Template analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       granularity:
 *                         type: string
 *                       data_points:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             template_id:
 *                               type: string
 *                             start:
 *                               type: integer
 *                             end:
 *                               type: integer
 *                             sent:
 *                               type: integer
 *                             delivered:
 *                               type: integer
 *                             read:
 *                               type: integer
 *                             clicked:
 *                               type: array
 *                               items:
 *                                 type: object
 *                                 properties:
 *                                   type:
 *                                     type: string
 *                                   button_content:
 *                                     type: string
 *                                   count:
 *                                     type: integer
 *                 paging:
 *                   type: object
 *                   properties:
 *                     cursors:
 *                       type: object
 *                       properties:
 *                         before:
 *                           type: string
 *                         after:
 *                           type: string
 *                 fallback:
 *                   type: boolean
 */
// GET /api/acc-matrics/template-analytics
router.get("/template-analytics", authenticateToken, async (req, res, next) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Get user's WhatsApp setup
    const userSetup = await getUserWhatsAppSetup(userId);

    const querySchema = z.object({
      start: z.coerce.number(),
      end: z.coerce.number(),
      granularity: z.enum(["DAILY"]),
      // Accept single value or repeated keys; coerce to array of strings
      template_ids: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return [v];
          return v;
        }, z.array(z.string()).min(1).max(10)),
      // Accept single value or repeated keys; coerce to array of strings
      metric_types: z
        .preprocess((v) => {
          if (v === undefined) return undefined;
          if (Array.isArray(v)) return v;
          if (typeof v === "string") return [v];
          return v;
        }, z.array(z.enum(["SENT", "DELIVERED", "READ", "CLICKED"])).optional()),
    });

    const query = querySchema.parse(req.query);

    // Build the fields query string
    let fields = `template_analytics?start=${query.start}&end=${query.end}&granularity=${query.granularity}&template_ids=[${query.template_ids.join(",")}]`;
    
    if (query.metric_types && query.metric_types.length > 0) {
      fields += `&metric_types=[${query.metric_types.map(m => `'${m}'`).join(",")}]`;
    }

    const data = await withFallback({
      feature: "getTemplateAnalytics",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${userSetup.waba_id}?fields=${encodeURIComponent(fields)}`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': userSetup.waba_id,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Template analytics API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        data: [
          {
            granularity: "DAILY",
            data_points: [
              {
                template_id: query.template_ids[0],
                start: query.start,
                end: query.start + 86400,
                sent: 0,
                delivered: 0,
                read: 0,
                clicked: [
                  {
                    type: "quick_reply_button",
                    button_content: "Tell me more",
                    count: 3
                  },
                  {
                    type: "quick_reply_button",
                    button_content: "Get coupon",
                    count: 5
                  }
                ]
              }
            ]
          }
        ],
        paging: {
          cursors: {
            before: "MAZDZD",
            after: "MjQZD"
          }
        },
        fallback: true
      })
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/acc-matrics/analytics-summary:
 *   get:
 *     tags:
 *       - Account Metrics
 *     summary: Get Analytics Summary
 *     description: Gets a comprehensive summary of all analytics including message, conversation, and template metrics.
 *     parameters:
 *       - in: query
 *         name: start
 *         required: true
 *         schema:
 *           type: integer
 *         description: Start date (Unix timestamp)
 *         example: 1693506600
 *       - in: query
 *         name: end
 *         required: true
 *         schema:
 *           type: integer
 *         description: End date (Unix timestamp)
 *         example: 1706725800
 *     responses:
 *       200:
 *         description: Analytics summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message_summary:
 *                   type: object
 *                   properties:
 *                     total_sent:
 *                       type: integer
 *                     total_delivered:
 *                       type: integer
 *                     delivery_rate:
 *                       type: number
 *                 conversation_summary:
 *                   type: object
 *                   properties:
 *                     total_conversations:
 *                       type: integer
 *                     total_cost:
 *                       type: number
 *                 template_summary:
 *                   type: object
 *                   properties:
 *                     total_templates:
 *                       type: integer
 *                     total_clicks:
 *                       type: integer
 *                 fallback:
 *                   type: boolean
 */
// GET /api/acc-matrics/analytics-summary
router.get("/analytics-summary", authenticateToken, async (req, res, next) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Get user's WhatsApp setup
    const userSetup = await getUserWhatsAppSetup(userId);

    const querySchema = z.object({
      start: z.coerce.number(),
      end: z.coerce.number(),
    });

    const query = querySchema.parse(req.query);

    const data = await withFallback({
      feature: "getAnalyticsSummary",
      attempt: async () => {
        // Get message analytics
        const messageFields = `analytics.start(${query.start}).end(${query.end}).granularity(MONTH)`;
        const messageResponse = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${userSetup.waba_id}?fields=${encodeURIComponent(messageFields)}`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': userSetup.waba_id,
            'Content-Type': 'application/json'
          }
        });

        // Get conversation analytics
        const conversationFields = `conversation_analytics.start(${query.start}).end(${query.end}).granularity(MONTHLY)`;
        const conversationResponse = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${userSetup.waba_id}?fields=${encodeURIComponent(conversationFields)}`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': userSetup.waba_id,
            'Content-Type': 'application/json'
          }
        });

        const messageData = await messageResponse.json();
        const conversationData = await conversationResponse.json();

        // Calculate summaries
        const messageSummary = {
          total_sent: 0,
          total_delivered: 0,
          delivery_rate: 0,
        };

        if (messageData.analytics?.data_points) {
          messageData.analytics.data_points.forEach((point: any) => {
            messageSummary.total_sent += point.sent || 0;
            messageSummary.total_delivered += point.delivered || 0;
          });
          messageSummary.delivery_rate = messageSummary.total_sent > 0 
            ? (messageSummary.total_delivered / messageSummary.total_sent) * 100 
            : 0;
        }

        const conversationSummary = {
          total_conversations: 0,
          total_cost: 0,
        };

        if (conversationData.conversation_analytics?.data) {
          conversationData.conversation_analytics.data.forEach((item: any) => {
            item.data_points?.forEach((point: any) => {
              conversationSummary.total_conversations += point.conversation || 0;
              conversationSummary.total_cost += point.cost || 0;
            });
          });
        }

        return {
          message_summary: messageSummary,
          conversation_summary: conversationSummary,
          template_summary: {
            total_templates: 0,
            total_clicks: 0,
          }
        };
      },
      fallback: () => ({
        message_summary: {
          total_sent: 21524000,
          total_delivered: 20589911,
          delivery_rate: 95.66,
        },
        conversation_summary: {
          total_conversations: 1500,
          total_cost: 1250.50,
        },
        template_summary: {
          total_templates: 25,
          total_clicks: 850,
        },
        fallback: true
      })
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
