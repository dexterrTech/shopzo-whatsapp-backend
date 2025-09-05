import { Router } from "express";
import { z } from "zod";
import { interaktClient } from "../services/interaktClient";
import { withFallback } from "../utils/fallback";
import { env } from "../config/env";
import { upsertBillingLog, BillingCategory, chargeWalletForBilling, resolveUserPricePlan, basePriceForCategory } from "../services/billingService";
import { authenticateToken } from "../middleware/authMiddleware";
import { pool } from "../config/database";

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Webhook
 *     description: Facebook webhook verification and message status updates
 *   - name: Phone Numbers
 *     description: Interakt phone number management
 *   - name: Templates
 *     description: WhatsApp message template management
 *   - name: Template Message Send
 *     description: Send WhatsApp template messages
 *   - name: Chat Message Send
 *     description: Send WhatsApp session/chat messages
 *   - name: Analytics
 *     description: WhatsApp message analytics and metrics
 */

/**
 * @openapi
 * /api/interaktWebhook:
 *   get:
 *     tags:
 *       - Webhook
 *     summary: Webhook Verification
 *     description: Interakt webhook verification endpoint. Returns hub.challenge parameter for verification as per Interakt documentation.
 *     parameters:
 *       - in: query
 *         name: hub.challenge
 *         schema:
 *           type: string
 *         description: Challenge string to verify webhook
 *         required: true
 *         example: "123456"
 *     responses:
 *       200:
 *         description: Webhook verified successfully - returns the hub.challenge value
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: "123456"
 */
// GET /api/interakt/interaktWebhook - Webhook verification
router.get("/interaktWebhook", (req, res) => {
  const challenge = req.query["hub.challenge"];

  console.log("Webhook verification attempt:", { challenge });

  // According to Interakt documentation: simply return the hub.challenge value
  if (challenge) {
    console.log("Webhook verified - returning challenge:", challenge);
    res.status(200).send(challenge);
  } else {
    console.log("Webhook verification failed - no challenge provided");
    res.status(200).send("OK");
  }
});

/**
 * @openapi
 * /api/interaktWebhook:
 *   post:
 *     tags:
 *       - Webhook
 *     summary: Webhook Message Updates
 *     description: Receives message status updates and incoming messages from Facebook
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook received successfully
 */
// POST /api/interakt/interaktWebhook - Receive webhook updates
router.post("/interaktWebhook", async (req, res) => {
  const body = req.body;
  console.log("Webhook received:", JSON.stringify(body, null, 2));

  try {
    // Handle different webhook events
    if (body.object === "whatsapp_business_account") {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          if (change.value?.messages) {
            // Handle incoming messages
            console.log("Incoming message:", change.value.messages);
          }
          if (change.value?.statuses) {
            // Handle message status updates
            console.log("Message status update:", change.value.statuses);
            // Optional: basic example to upsert billing log when status indicates conversation charged
            (async () => {
              try {
                const statuses = change.value.statuses as any[];
                for (const st of statuses) {
                  const conversationId = st?.conversation?.id || st?.id || st?.message_id;
                  const recipient = st?.recipient_id || st?.recipient || '';
                  const categoryRaw: string | undefined = st?.conversation?.category;
                  const category: BillingCategory | undefined = categoryRaw ? categoryRaw.toLowerCase() as BillingCategory : undefined;
                  const timestamp = st?.timestamp ? new Date(parseInt(st.timestamp) * 1000) : new Date();
                  // Resolve userId via phone_number_id or waba_id mapping
                  const phoneId = st?.pricing?.billable ? (st?.id || st?.recipient_id) : undefined;
                  const wabaId = (change as any)?.value?.metadata?.phone_number_id ? undefined : undefined;
                  let userId: number | undefined;
                  if (st?.phone_number_id) {
                    const r = await pool.query('SELECT user_id FROM waba_sources WHERE phone_number_id = $1 LIMIT 1', [st.phone_number_id]);
                    userId = r.rows[0]?.user_id;
                  } else if ((change as any)?.value?.metadata?.phone_number_id) {
                    const r = await pool.query('SELECT user_id FROM waba_sources WHERE phone_number_id = $1 LIMIT 1', [(change as any).value.metadata.phone_number_id]);
                    userId = r.rows[0]?.user_id;
                  }
                  if (conversationId && category) {
                    if (userId) {
                      await upsertBillingLog({
                        userId,
                        conversationId,
                        category,
                        recipientNumber: recipient,
                        startTime: timestamp,
                        endTime: timestamp,
                        billingStatus: 'pending',
                      });
                    }
                  }
                }
              } catch (e) {
                console.warn('Billing upsert from webhook skipped:', e);
              }
            })();
          }
        });
      });
    }

    // Handle tech partner events
    if (body.object === "tech_partner") {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          if (change.value?.event === "PARTNER_ADDED") {
            console.log("PARTNER_ADDED event received:", change.value);
            
            // Trigger onboarding process
            // You can either handle it here or call the separate endpoint
            // For now, we'll just log it and let the separate endpoint handle it
            console.log("Tech partner onboarding should be triggered for WABA:", change.value.waba_info?.waba_id);
          }
        });
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.sendStatus(500);
  }
});

/**
 * @openapi
 * /api/interakt/test-message:
 *   post:
 *     tags:
 *       - Template Message Send
 *     summary: Test Template Message (Facebook Graph API)
 *     description: Send a test template message using Facebook Graph API format. This matches the curl command provided.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - template_name
 *             properties:
 *               to:
 *                 type: string
 *                 description: Recipient phone number (E.164 format)
 *                 example: "917447340010"
 *               template_name:
 *                 type: string
 *                 description: Template name to send
 *                 example: "hello_world"
 *               language_code:
 *                 type: string
 *                 description: Language code for template
 *                 default: "en_US"
 *                 example: "en_US"
 *     responses:
 *       202:
 *         description: Test message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message_id:
 *                   type: string
 *                 recipient:
 *                   type: string
 *                 template:
 *                   type: string
 */
// POST /api/interakt/test-message - Test message endpoint matching sir's curl
router.post("/test-message", authenticateToken, async (req, res, next) => {
  try {
    const bodySchema = z.object({
      to: z.string().min(1),
      template_name: z.string().min(1),
      language_code: z.string().default("en_US"),
    });

    const body = bodySchema.parse(req.body);

    // Build payload matching sir's curl command format
    const payload = {
      messaging_product: "whatsapp" as const,
      to: body.to,
      type: "template" as const,
      template: {
        name: body.template_name,
        language: {
          code: body.language_code,
        },
      },
    };

    // Send via Interakt client (will use Facebook Graph API)
    const data = await withFallback({
      feature: "sendTestTemplate",
      attempt: () => interaktClient.sendTestTemplate(payload),
      fallback: () => ({
        success: true,
        message_id: "test-msg-" + Math.random().toString(36).slice(2, 8),
        recipient: body.to,
        template: body.template_name,
        fallback: true,
      }),
    });

    res.status(202).json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/interakt/phone-numbers:
 *   get:
 *     tags:
 *       - Phone Numbers
 *     summary: Get Phone Numbers
 *     description: Returns all phone numbers associated with your WABA ID from Interakt
 *     responses:
 *       200:
 *         description: List of phone numbers retrieved successfully
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
 *                       verified_name:
 *                         type: string
 *                       display_phone_number:
 *                         type: string
 *                       id:
 *                         type: string
 *                         description: This is the phone_number_id you need for webhook configuration
 *                       quality_rating:
 *                         type: string
 *                       platform_type:
 *                         type: string
 */
// GET /api/interakt/phone-numbers - Get Phone Numbers from Interakt
router.get("/phone-numbers", authenticateToken, async (req, res, next) => {
  try {
    console.log("Getting phone numbers from Interakt...");
    
    const response = await withFallback({
      feature: "getPhoneNumbers",
      attempt: async () => {
        const url = `https://amped-express.interakt.ai/api/v17.0/${env.INTERAKT_WABA_ID}/phone_numbers`;
        console.log("Attempting phone numbers API call with:", {
          url,
          token: env.INTERAKT_ACCESS_TOKEN ? `${env.INTERAKT_ACCESS_TOKEN.substring(0, 20)}...` : 'NOT_SET',
          waba_id: env.INTERAKT_WABA_ID || 'NOT_SET'
        });
        
        // Try different header combinations
        const headerCombinations: Record<string, string>[] = [
          {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          {
            'Authorization': `Bearer ${env.INTERAKT_ACCESS_TOKEN || ''}`,
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || ''
          }
        ];

        let lastError = null;
        
        for (const headers of headerCombinations) {
          try {
            console.log(`Trying headers:`, Object.keys(headers));
            
            const response = await fetch(url, {
              method: 'GET',
              headers
            });

            console.log(`Headers ${Object.keys(headers)} response status:`, response.status);
            
            if (response.ok) {
              const responseData = await response.json();
              console.log("Phone numbers API success response:", responseData);
              return responseData;
            } else {
              const errorText = await response.text();
              console.log(`Headers ${Object.keys(headers)} error response:`, errorText);
              if (response.status !== 400) {
                // If it's not a 400 error, this header combination might be working
                lastError = new Error(`Phone numbers API error: ${response.status} ${response.statusText} - ${errorText}`);
                break;
              }
              lastError = new Error(`Phone numbers API error: ${response.status} ${response.statusText} - ${errorText}`);
            }
          } catch (headerError: any) {
            console.log(`Headers ${Object.keys(headers)} failed:`, headerError.message);
            lastError = headerError;
          }
        }
        
        // If all headers failed, throw the last error
        throw lastError || new Error("All header combinations failed");
      },
      fallback: () => {
        console.log("Using fallback response for phone numbers");
        return {
          data: [
            {
              verified_name: "Fallback Business",
              display_phone_number: "+91 88888 88888",
              id: env.INTERAKT_PHONE_NUMBER_ID || "fallback_phone_id",
              quality_rating: "GREEN",
              platform_type: "CLOUD_API"
            }
          ],
          fallback: true
        };
      }
    });

    console.log("Phone numbers retrieved:", response);
    res.json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/interakt/templates:
 *   get:
 *     tags:
 *       - Templates
 *     summary: Get All Templates
 *     description: Returns WABA message templates or mocked data when fallback is active.
 *     parameters:
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *         description: Fields to include in response
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of templates to return
 *     responses:
 *       200:
 *         description: List of templates
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
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       language:
 *                         type: string
 *                       status:
 *                         type: string
 *                       category:
 *                         type: string
 *                       components:
 *                         type: array
 */
// Template fetching endpoints have been moved to /api/templates
// Use the new user-specific template endpoints instead

/**
 * @openapi
 * /api/interakt/templates:
 *   post:
 *     tags:
 *       - Templates
 *     summary: Create Text Template
 *     description: Creates a new WhatsApp message template via Interakt or returns a mocked template when fallback is active.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - language
 *               - category
 *               - components
 *             properties:
 *               name:
 *                 type: string
 *                 description: Template name
 *               language:
 *                 type: string
 *                 description: Template language code
 *               category:
 *                 type: string
 *                 enum: [AUTHENTICATION, MARKETING, UTILITY]
 *                 description: Template category
 *               components:
 *                 type: array
 *                 description: Template components (header, body, footer, buttons)
 *               auto_category:
 *                 type: boolean
 *                 description: Auto-categorize template
 *     responses:
 *       201:
 *         description: Template created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 status:
 *                   type: string
 *                 category:
 *                   type: string
 * 
 * @openapi
 * /api/interakt/templates/media:
 *   post:
 *     tags:
 *       - Templates
 *     summary: Create Media Template
 *     description: Creates a new WhatsApp media template (image, video, document) via Interakt. Media templates can include images, videos, or documents in the header.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - language
 *               - category
 *               - components
 *             properties:
 *               name:
 *                 type: string
 *                 description: Template name
 *               language:
 *                 type: string
 *                 description: Template language code
 *               category:
 *                 type: string
 *                 enum: [AUTHENTICATION, MARKETING, UTILITY]
 *                 description: Template category
 *               components:
 *                 type: array
 *                 description: Template components with media header
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [HEADER, BODY, FOOTER, BUTTONS]
 *                     format:
 *                       type: string
 *                       enum: [IMAGE, VIDEO, DOCUMENT]
 *                       description: Media format (for HEADER type)
 *                     example:
 *                       type: object
 *                       properties:
 *                         header_handle:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: Media asset handle from Resumable Upload API
 *                         body_text:
 *                           type: array
 *                           description: Example body text parameters
 *     responses:
 *       201:
 *         description: Media template created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 status:
 *                   type: string
 *                 category:
 *                   type: string
 */
// Template creation endpoints have been moved to /api/templates
// Use the new user-specific template endpoints instead

/**
 * @openapi
 * /api/interakt/templates/{id}:
 *   get:
 *     tags:
 *       - Templates
 *     summary: Get Template by ID
 *     description: Returns a specific template by ID from Interakt or mocked data when fallback is active.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Template details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 language:
 *                   type: string
 *                 status:
 *                   type: string
 *                 category:
 *                   type: string
 *                 components:
 *                   type: array
 */
// Individual template fetching has been moved to /api/templates/:id
// Use the new user-specific template endpoints instead

/**
 * @openapi
 * /api/interakt/messages:
 *   post:
 *     tags:
 *       - Template Message Send
 *     summary: Send Text Template Message
 *     description: Sends a pre-approved WhatsApp message template to a single recipient via Interakt. Template messages are used for notifications, customer care, and marketing campaigns. This endpoint supports all approved template types including text-based, media-based, interactive, and authentication templates.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - to
 *               - type
 *               - template
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 enum: [whatsapp]
 *                 description: Must be "whatsapp"
 *               recipient_type:
 *                 type: string
 *                 enum: [individual]
 *                 default: individual
 *                 description: Recipient type
 *               to:
 *                 type: string
 *                 description: Recipient phone number
 *               type:
 *                 type: string
 *                 enum: [template]
 *                 description: Message type
 *               template:
 *                 type: object
 *                 description: Template details
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: Template name
 *                   language:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                         description: Language code
 *                   components:
 *                     type: array
 *                     description: Template components with parameters
 *             example:
 *               messaging_product: "whatsapp"
 *               recipient_type: "individual"
 *               to: "+919999595313"
 *               type: "template"
 *               template:
 *                 name: "test_template"
 *                 language:
 *                   code: "en"
 *     responses:
 *       202:
 *         description: Message accepted for delivery
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messaging_product:
 *                   type: string
 *                 contacts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       input:
 *                         type: string
 *                       wa_id:
 *                         type: string
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       message_status:
 *                         type: string
 */
// Template message sending has been moved to /api/templates/send
// Use the new user-specific template endpoints instead

// POST /api/interakt/messages/media
router.post("/messages/media", authenticateToken, async (req, res, next) => {
  try {
    const payload = z
      .object({
        messaging_product: z.literal("whatsapp"),
        recipient_type: z.literal("individual").default("individual"),
        to: z.string(),
        type: z.literal("template"),
        template: z.object({
          name: z.string(),
          language: z.object({
            code: z.string(),
          }),
          components: z.array(z.object({
            type: z.enum(["header", "body", "footer", "buttons"]),
            parameters: z.array(z.object({
              type: z.enum(["image", "video", "document", "text"]),
              image: z.object({
                link: z.string(),
              }).optional(),
              video: z.object({
                link: z.string(),
              }).optional(),
              document: z.object({
                link: z.string(),
              }).optional(),
              text: z.string().optional(),
            })),
          })),
        }),
      })
      .parse(req.body);

    // Pre-send balance check
    try {
      const userId = (req as any).user?.userId as number | undefined;
      if (userId) {
        const templateName = (payload as any)?.template?.name || '';
        let category: BillingCategory = 'utility';
        const n = String(templateName).toLowerCase();
        if (n.includes('auth')) category = 'authentication';
        else if (n.includes('market') || n.includes('promo')) category = 'marketing';
        const plan = await resolveUserPricePlan(userId);
        const amount = basePriceForCategory(plan, category);
        if (amount > 0) {
          const balRes = await pool.query('SELECT balance_paise FROM wallet_accounts WHERE user_id = $1', [userId]);
          const balance = balRes.rows[0]?.balance_paise ?? 0;
          if (balance < amount) {
            return res.status(402).json({ success: false, message: 'Insufficient wallet balance' });
          }
        }
      }
    } catch (e) {
      console.warn('Pre-send balance check failed (continuing):', e);
    }

    const data = await withFallback({
      feature: "sendMediaTemplate",
      attempt: () => interaktClient.sendMediaTemplate(payload),
      fallback: () => ({
        messaging_product: "whatsapp",
        contacts: [{ input: payload.to, wa_id: payload.to }],
        messages: [{ id: "mock-media-msg-id", message_status: "accepted" }],
        fallback: true,
      }),
    });

    try {
      const userId = (req as any).user?.userId as number | undefined;
      const conversationId = data?.messages?.[0]?.id;
      const templateName = (payload as any)?.template?.name || '';
      let category: BillingCategory = 'utility';
      const n = String(templateName).toLowerCase();
      if (n.includes('auth')) category = 'authentication';
      else if (n.includes('market') || n.includes('promo')) category = 'marketing';
      if (userId && conversationId) {
        const ins = await upsertBillingLog({
          userId,
          conversationId,
          category,
          recipientNumber: payload.to,
          startTime: new Date(),
          endTime: new Date(),
          billingStatus: 'pending',
        });
        if (ins) {
          const amountRes = await pool.query('SELECT amount_paise, amount_currency FROM billing_logs WHERE id = $1', [ins.id]);
          const row = amountRes.rows[0];
          if (row) {
            await chargeWalletForBilling({ userId, conversationId, amountPaise: row.amount_paise, currency: row.amount_currency });
          }
        }
      }
    } catch (e) {
      console.warn('send media billing log skipped:', e);
    }

    res.status(202).json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/interakt/messages/media:
 *   post:
 *     tags:
 *       - Template Message Send
 *     summary: Send Media Template Message
 *     description: Sends a media-based WhatsApp template message (image, video, document) to a single recipient via Interakt. Media templates can include images, videos, or documents in the header with dynamic parameters.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - to
 *               - type
 *               - template
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 enum: [whatsapp]
 *                 description: Must be "whatsapp"
 *               recipient_type:
 *                 type: string
 *                 enum: [individual]
 *                 default: individual
 *                 description: Recipient type
 *               to:
 *                 type: string
 *                 description: Recipient phone number
 *               type:
 *                 type: string
 *                 enum: [template]
 *                 description: Message type
 *               template:
 *                 type: object
 *                 description: Media template details
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: Template name
 *                   language:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                         description: Language code
 *                   components:
 *                     type: array
 *                     description: Template components with media parameters
 *                     items:
 *                       type: object
 *                       properties:
 *                         type:
 *                           type: string
 *                           enum: [header, body, footer, buttons]
 *                         parameters:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               type:
 *                                 type: string
 *                                 enum: [image, video, document, text]
 *                               image:
 *                                 type: object
 *                                 properties:
 *                                   link:
 *                                     type: string
 *                                     description: Image URL
 *                               video:
 *                                 type: object
 *                                 properties:
 *                                   link:
 *                                     type: string
 *                                     description: Video URL
 *                               document:
 *                                 type: object
 *                                 properties:
 *                                   link:
 *                                     type: string
 *                                     description: Document URL
 *                               text:
 *                                 type: string
 *                                 description: Text parameter value
 *             example:
 *               messaging_product: "whatsapp"
 *               recipient_type: "individual"
 *               to: "919999595313"
 *               type: "template"
 *               template:
 *                 name: "test_template"
 *                 language:
 *                   code: "en"
 *                 components:
 *                   - type: "header"
 *                     parameters:
 *                       - type: "image"
 *                         image:
 *                           link: "https://example.com/image.jpg"
 *                   - type: "body"
 *                     parameters:
 *                       - type: "text"
 *                         text: "John"
 *     responses:
 *       202:
 *         description: Media template message accepted for delivery
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messaging_product:
 *                   type: string
 *                 contacts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       input:
 *                         type: string
 *                       wa_id:
 *                         type: string
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       message_status:
 *                         type: string
 * 
 * @openapi
 * /api/interakt/session-messages:
 *   post:
 *     tags:
 *       - Chat Message Send
 *     summary: Send Chat/Session Message
 *     description: Sends a free-form session message (text, media, location, etc.) to a single recipient via Interakt. Session messages are non-template messages sent during a conversation. This endpoint supports text, image, video, audio, document, location, contact, sticker, reaction, and interactive message types.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - to
 *               - type
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 enum: [whatsapp]
 *                 description: Must be "whatsapp"
 *               recipient_type:
 *                 type: string
 *                 enum: [individual]
 *                 default: individual
 *                 description: Recipient type
 *               to:
 *                 type: string
 *                 description: Recipient phone number
 *               type:
 *                 type: string
 *                 enum: [text, image, video, audio, document, location, contact, sticker, reaction, interactive]
 *                 description: Type of message to send
 *               text:
 *                 type: object
 *                 description: Text message content (required if type is text)
 *                 properties:
 *                   body:
 *                     type: string
 *                     description: Text message body
 *                   preview_url:
 *                     type: boolean
 *                     description: Whether to show URL preview for links in the message
 *               image:
 *                 type: object
 *                 description: Image message content (required if type is image)
 *                 properties:
 *                   link:
 *                     type: string
 *                     description: Image URL
 *                   caption:
 *                     type: string
 *                     description: Image caption
 *               video:
 *                 type: object
 *                 description: Video message content (required if type is video)
 *                 properties:
 *                   link:
 *                     type: string
 *                     description: Video URL
 *                   caption:
 *                     type: string
 *                     description: Video caption
 *               audio:
 *                 type: object
 *                 description: Audio message content (required if type is audio)
 *                 properties:
 *                   link:
 *                     type: string
 *                     description: Audio URL
 *               document:
 *                 type: object
 *                 description: Document message content (required if type is document)
 *                 properties:
 *                   link:
 *                     type: string
 *                     description: Document URL
 *                   caption:
 *                     type: string
 *                     description: Document caption
 *                   filename:
 *                     type: string
 *                     description: Document filename
 *               location:
 *                 type: object
 *                 description: Location message content (required if type is location)
 *                 properties:
 *                   latitude:
 *                     type: number
 *                     description: Latitude coordinate
 *                   longitude:
 *                     type: number
 *                     description: Longitude coordinate
 *                   name:
 *                     type: string
 *                     description: Location name
 *                   address:
 *                     type: string
 *                     description: Location address
 *               contact:
 *                 type: object
 *                 description: Contact message content (required if type is contact)
 *                 properties:
 *                   contacts:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: object
 *                           properties:
 *                             first_name:
 *                               type: string
 *                             last_name:
 *                               type: string
 *                         phones:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               phone:
 *                                 type: string
 *                               type:
 *                                 type: string
 *               sticker:
 *                 type: object
 *                 description: Sticker message content (required if type is sticker)
 *                 properties:
 *                   link:
 *                     type: string
 *                     description: Sticker URL
 *               reaction:
 *                 type: object
 *                 description: Reaction message content (required if type is reaction)
 *                 properties:
 *                   message_id:
 *                     type: string
 *                     description: ID of the message to react to
 *                   emoji:
 *                     type: string
 *                     description: Emoji reaction
 *               interactive:
 *                 type: object
 *                 description: Interactive message content (required if type is interactive)
 *             example:
 *               messaging_product: "whatsapp"
 *               recipient_type: "individual"
 *               to: "+919999595313"
 *               type: "text"
 *               text:
 *                 preview_url: false
 *                 body: "This is a test message"
 *     responses:
 *       202:
 *         description: Session message accepted for delivery
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messaging_product:
 *                   type: string
 *                 contacts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       input:
 *                         type: string
 *                       wa_id:
 *                         type: string
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       message_status:
 *                         type: string
 */
// POST /api/interakt/session-messages
router.post("/session-messages", authenticateToken, async (req, res, next) => {
  try {
    const payload = z
      .object({
        messaging_product: z.literal("whatsapp"),
        recipient_type: z.literal("individual").default("individual"),
        to: z.string(),
        type: z.enum(["text", "image", "video", "audio", "document", "location", "contact", "sticker", "reaction", "interactive"]),
        text: z.object({ 
          body: z.string(),
          preview_url: z.boolean().optional()
        }).optional(),
        image: z.object({ link: z.string(), caption: z.string().optional() }).optional(),
        video: z.object({ link: z.string(), caption: z.string().optional() }).optional(),
        audio: z.object({ link: z.string() }).optional(),
        document: z.object({ 
          link: z.string(), 
          caption: z.string().optional(), 
          filename: z.string().optional() 
        }).optional(),
        location: z.object({ 
          latitude: z.number(), 
          longitude: z.number(), 
          name: z.string().optional(), 
          address: z.string().optional() 
        }).optional(),
        contact: z.object({ 
          contacts: z.array(z.object({
            name: z.object({ 
              first_name: z.string(), 
              last_name: z.string().optional() 
            }),
            phones: z.array(z.object({ 
              phone: z.string(), 
              type: z.string().optional() 
            }))
          }))
        }).optional(),
        sticker: z.object({ link: z.string() }).optional(),
        reaction: z.object({ 
          message_id: z.string(),
          emoji: z.string()
        }).optional(),
        interactive: z.any().optional(),
      })
      .refine((data) => {
        // Ensure the appropriate content object is provided based on type
        switch (data.type) {
          case "text":
            return !!data.text;
          case "image":
            return !!data.image;
          case "video":
            return !!data.video;
          case "audio":
            return !!data.audio;
          case "document":
            return !!data.document;
          case "location":
            return !!data.location;
          case "contact":
            return !!data.contact;
          case "sticker":
            return !!data.sticker;
          case "reaction":
            return !!data.reaction;
          case "interactive":
            return !!data.interactive;
          default:
            return false;
        }
      }, {
        message: "Message content must be provided based on the message type"
      })
      .parse(req.body);

    // Pre-send balance check for service category
    try {
      const userId = (req as any).user?.userId as number | undefined;
      if (userId) {
        const plan = await resolveUserPricePlan(userId);
        const amount = basePriceForCategory(plan, 'service');
        if (amount > 0) {
          const balRes = await pool.query('SELECT balance_paise FROM wallet_accounts WHERE user_id = $1', [userId]);
          const balance = balRes.rows[0]?.balance_paise ?? 0;
          if (balance < amount) {
            return res.status(402).json({ success: false, message: 'Insufficient wallet balance' });
          }
        }
      }
    } catch (e) {
      console.warn('Pre-send balance check failed (continuing):', e);
    }

    const data = await withFallback({
      feature: "sendSessionMessage",
      attempt: () => interaktClient.sendSessionMessage(payload),
      fallback: () => ({
        messaging_product: "whatsapp",
        contacts: [{ input: payload.to, wa_id: payload.to }],
        messages: [{ id: "mock-session-msg-id", message_status: "accepted" }],
        fallback: true,
      }),
    });

    try {
      const userId = (req as any).user?.userId as number | undefined;
      const conversationId = data?.messages?.[0]?.id;
      if (userId && conversationId) {
        const ins = await upsertBillingLog({
          userId,
          conversationId,
          category: 'service',
          recipientNumber: payload.to,
          startTime: new Date(),
          endTime: new Date(),
          billingStatus: 'pending',
        });
        if (ins) {
          const amountRes = await pool.query('SELECT amount_paise, amount_currency FROM billing_logs WHERE id = $1', [ins.id]);
          const row = amountRes.rows[0];
          if (row) {
            await chargeWalletForBilling({ userId, conversationId, amountPaise: row.amount_paise, currency: row.amount_currency });
          }
        }
      }
    } catch (e) {
      console.warn('session message billing log skipped:', e);
    }

    res.status(202).json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/interakt/tech-partner-onboarding:
 *   post:
 *     tags:
 *       - Webhook
 *     summary: Tech Partner Onboarding
 *     description: Handles tech partner onboarding when PARTNER_ADDED event is received from Meta. This endpoint can be called manually if the webhook event is not received within 5-7 minutes.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - entry
 *             properties:
 *               entry:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     changes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           value:
 *                             type: object
 *                             properties:
 *                               event:
 *                                 type: string
 *                                 enum: [PARTNER_ADDED]
 *                               waba_info:
 *                                 type: object
 *                                 properties:
 *                                   waba_id:
 *                                     type: string
 *                                   solution_id:
 *                                     type: string
 *               object:
 *                 type: string
 *                 enum: [tech_partner]
 *     responses:
 *       200:
 *         description: Onboarding completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 event:
 *                   type: string
 *                   enum: [WABA_ONBOARDED]
 *                 isv_name_token:
 *                   type: string
 *                 waba_id:
 *                   type: string
 *                 phone_number_id:
 *                   type: string
 */
// POST /api/interakt/tech-partner-onboarding - Tech Partner Onboarding API (TEMP: No auth for testing)
router.post("/tech-partner-onboarding", authenticateToken, async (req, res, next) => {
  try {
    const bodySchema = z.object({
      entry: z.array(z.object({
        changes: z.array(z.object({
          value: z.object({
            event: z.literal("PARTNER_ADDED"),
            waba_info: z.object({
              waba_id: z.string(),
              solution_id: z.string(),
              phone_number: z.string().optional(),
            })
          })
        }))
      })),
      object: z.literal("tech_partner")
    });

    const body = bodySchema.parse(req.body);
    
    // Extract WABA info
    const wabaInfo = body.entry[0]?.changes[0]?.value?.waba_info;
    
    if (!wabaInfo) {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    // Call Interakt's API to trigger onboarding
    const onboardingResponse = await withFallback({
      feature: "techPartnerOnboarding",
      attempt: async () => {
        console.log("Node.js version:", process.version);
        console.log("Fetch available:", typeof fetch !== 'undefined');
        console.log("Attempting Interakt API call with:", {
          url: `https://api.interakt.ai/v1/organizations/tp-signup/`,
          token: env.INTERAKT_ACCESS_TOKEN ? `${env.INTERAKT_ACCESS_TOKEN.substring(0, 20)}...` : 'NOT_SET',
          body: JSON.stringify(body)
        });
        
        try {
          // Try fetch first
          if (typeof fetch !== 'undefined') {
            const response = await fetch(`https://api.interakt.ai/v1/organizations/tp-signup/`, {
              method: 'POST',
              headers: {
                // Per Interakt docs, this endpoint expects the raw token (no Bearer prefix)
                'Authorization': env.INTERAKT_ACCESS_TOKEN,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(body)
            });

            console.log("Interakt API response status:", response.status);
            console.log("Interakt API response headers:", Object.fromEntries(response.headers.entries()));

            if (!response.ok) {
              const errorText = await response.text();
              console.error("Interakt API error response:", errorText);
              throw new Error(`Interakt API error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const responseData = await response.json();
            console.log("Interakt API success response:", responseData);
            console.log("🔍 IMPORTANT: Check this response for phone_number_id!");
            return responseData;
          } else {
            // Fallback to Node.js http module
            console.log("Fetch not available, using Node.js http module");
            const https = require('https');
            
            return new Promise((resolve, reject) => {
              const postData = JSON.stringify(body);
              const options = {
                hostname: 'api.interakt.ai',
                port: 443,
                path: '/v1/organizations/tp-signup/',
                method: 'POST',
                headers: {
                  'Authorization': env.INTERAKT_ACCESS_TOKEN,
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(postData)
                }
              };

              const req = https.request(options, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => {
                  data += chunk;
                });
                res.on('end', () => {
                  console.log("Interakt API response status:", res.statusCode);
                  if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                      const responseData = JSON.parse(data);
                      console.log("Interakt API success response:", responseData);
                      console.log("🔍 IMPORTANT: Check this response for phone_number_id!");
                      resolve(responseData);
                    } catch (e) {
                      reject(new Error(`Failed to parse response: ${data}`));
                    }
                  } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                  }
                });
              });

              req.on('error', (err: any) => {
                reject(err);
              });

              req.write(postData);
              req.end();
            });
          }
        } catch (fetchError: any) {
          console.error("Fetch error details:", {
            message: fetchError.message,
            stack: fetchError.stack,
            name: fetchError.name
          });
          throw fetchError;
        }
      },
      fallback: () => {
        console.log("Using fallback response for tech partner onboarding");
        return {
          event: "WABA_ONBOARDED",
          isv_name_token: "mock-token-" + Math.random().toString(36).slice(2, 8),
          waba_id: wabaInfo.waba_id,
          phone_number_id: "mock-phone-" + Math.random().toString(36).slice(2, 8),
          fallback: true
        };
      }
    });

    console.log("Tech partner onboarding completed:", onboardingResponse);
    res.json(onboardingResponse);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/interakt/webhook-url:
 *   post:
 *     tags:
 *       - Webhook
 *     summary: Add/Update Webhook URL
 *     description: Configures the webhook URL for a specific WABA (WhatsApp Business Account) to receive real-time updates from Meta.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - waba_id
 *               - webhook_url
 *               - verify_token
 *             properties:
 *               waba_id:
 *                 type: string
 *                 description: WhatsApp Business Account ID
 *               webhook_url:
 *                 type: string
 *                 description: Webhook URL to receive updates
 *               verify_token:
 *                 type: string
 *                 description: Verification token for webhook security
 *     responses:
 *       200:
 *         description: Webhook URL configured successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
// POST /api/interakt/webhook-url - Add/Update Webhook URL
router.post("/webhook-url", authenticateToken, async (req, res, next) => {
  try {
    const bodySchema = z.object({
      waba_id: z.string(),
      webhook_url: z.string().url(),
      verify_token: z.string()
    });

    const { waba_id, webhook_url, verify_token } = bodySchema.parse(req.body);

    const response = await withFallback({
      feature: "configureWebhookUrl",
      attempt: async () => {
        console.log("Attempting webhook configuration with:", {
          url: `${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${waba_id}/subscribed_apps`,
          token: env.INTERAKT_ACCESS_TOKEN ? `${env.INTERAKT_ACCESS_TOKEN.substring(0, 20)}...` : 'NOT_SET',
          waba_id,
          webhook_url,
          verify_token
        });
        
        try {
          // Try different URL formats based on Interakt documentation
          const urlFormats = [
            `https://amped-express.interakt.ai/api/v17.0/${env.INTERAKT_PHONE_NUMBER_ID}`,
            `https://amped-express.interakt.ai/api/v18.0/${env.INTERAKT_PHONE_NUMBER_ID}`,
            `https://amped-express.interakt.ai/api/v19.0/${env.INTERAKT_PHONE_NUMBER_ID}`,
            `https://amped-express.interakt.ai/api/v20.0/${env.INTERAKT_PHONE_NUMBER_ID}`,
            `https://amped-express.interakt.ai/api/v21.0/${env.INTERAKT_PHONE_NUMBER_ID}`,
            `https://amped-express.interakt.ai/api/v22.0/${env.INTERAKT_PHONE_NUMBER_ID}`,
            `https://amped-express.interakt.ai/api/v17.0/PHONE_NUMBER_ID`.replace('PHONE_NUMBER_ID', env.INTERAKT_PHONE_NUMBER_ID || ''),
            `${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${env.INTERAKT_PHONE_NUMBER_ID}`,
            `${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/subscribed_apps`
          ];

          let lastError = null;
          
          for (const url of urlFormats) {
            try {
              console.log(`Trying webhook configuration URL: ${url}`);
              
              // Try different header combinations
              const headerCombinations: Record<string, string>[] = [
                {
                  'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
                  'x-waba-id': waba_id,
                  'x-phone-number-id': env.INTERAKT_PHONE_NUMBER_ID || '',
                  'Content-Type': 'application/json'
                },
                {
                  'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
                  'x-waba-id': waba_id,
                  'Content-Type': 'application/json'
                },
                {
                  'Authorization': env.INTERAKT_ACCESS_TOKEN || '',
                  'x-waba-id': waba_id,
                  'Content-Type': 'application/json'
                }
              ];

              let headerSuccess = false;
              
              for (const headers of headerCombinations) {
                try {
                  console.log(`Trying headers:`, Object.keys(headers));
                  
                  // Try different request body formats
                  const bodyFormats = [
                    {
                      webhook_configuration: {
                        override_callback_uri: webhook_url,
                        verify_token: verify_token
                      }
                    },
                    {
                      override_callback_uri: webhook_url,
                      verify_token: verify_token
                    },
                    {
                      callback_uri: webhook_url,
                      verify_token: verify_token
                    }
                  ];
                  
                  let bodySuccess = false;
                  
                  for (const bodyFormat of bodyFormats) {
                    try {
                      console.log(`Trying body format:`, Object.keys(bodyFormat));
                      
                      const response = await fetch(url, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(bodyFormat)
                      });

                      console.log(`URL ${url} with headers ${Object.keys(headers)} and body ${Object.keys(bodyFormat)} response status:`, response.status);
                      
                      if (response.ok) {
                        const responseData = await response.json();
                        console.log("Webhook configuration success response:", responseData);
                        return responseData;
                      } else {
                        const errorText = await response.text();
                        console.log(`URL ${url} with headers ${Object.keys(headers)} and body ${Object.keys(bodyFormat)} error response:`, errorText);
                        if (response.status !== 400) {
                          // If it's not a 400 error, this combination might be working
                          bodySuccess = true;
                          lastError = new Error(`Webhook configuration error: ${response.status} ${response.statusText} - ${errorText}`);
                          break;
                        }
                      }
                    } catch (bodyError: any) {
                      console.log(`Body format ${Object.keys(bodyFormat)} failed:`, bodyError.message);
                    }
                  }
                  
                  if (bodySuccess) {
                    break; // Move to next header if body worked but header didn't
                  }
                  
                } catch (headerError: any) {
                  console.log(`Headers ${Object.keys(headers)} failed:`, headerError.message);
                }
              }
              
              if (headerSuccess) {
                break; // Move to next URL if headers worked but URL didn't
              }
              
            } catch (urlError: any) {
              console.log(`URL ${url} failed:`, urlError.message);
              lastError = urlError;
            }
          }
          
          // If all URLs failed, throw the last error
          throw lastError || new Error("All webhook configuration URLs failed");
        } catch (fetchError: any) {
          console.error("Webhook configuration fetch error details:", {
            message: fetchError.message,
            stack: fetchError.stack,
            name: fetchError.name
          });
          throw fetchError;
        }
      },
      fallback: () => ({
        success: true,
        message: "Webhook URL configured successfully (fallback mode)",
        waba_id,
        webhook_url,
        fallback: true
      })
    });

    console.log("Webhook URL configured:", response);
    res.json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/interakt/analytics:
 *   get:
 *     tags:
 *       - Analytics
 *     summary: Get Message Analytics
 *     description: Retrieves WhatsApp message analytics and metrics from Interakt Amped Express API. This is the primary analytics endpoint for getting message delivery, read receipts, and other performance metrics.
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: integer
 *         description: Start timestamp (Unix timestamp)
 *         example: 1693506600
 *       - in: query
 *         name: end
 *         schema:
 *           type: integer
 *         description: End timestamp (Unix timestamp)
 *         example: 1706725800
 *       - in: query
 *         name: granularity
 *         schema:
 *           type: string
 *           enum: [DAY, MONTH, YEAR]
 *         description: Time granularity for analytics
 *         example: MONTH
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *         description: Custom fields query string
 *         example: "analytics.start(1693506600).end(1706725800).granularity(MONTH)"
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 analytics:
 *                   type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           date:
 *                             type: string
 *                             format: date
 *                           delivered:
 *                             type: integer
 *                           read:
 *                             type: integer
 *                           sent:
 *                             type: integer
 *                           failed:
 *                             type: integer
 *                 fallback:
 *                   type: boolean
 *                   description: Indicates if fallback data was used
 */
// GET /api/interakt/analytics - Message Analytics API
router.get("/analytics", authenticateToken, async (req, res, next) => {
  try {
    const querySchema = z.object({
      start: z.coerce.number().optional(),
      end: z.coerce.number().optional(),
      granularity: z.enum(["DAY", "MONTH", "YEAR"]).optional(),
      fields: z.string().optional(),
    });

    const query = querySchema.parse(req.query);

    const data = await withFallback({
      feature: "getMessageAnalytics",
      attempt: () => interaktClient.getMessageAnalytics(query),
      fallback: () => ({
        analytics: {
          data: [
            {
              date: "2024-01-01",
              delivered: 1250,
              read: 980,
              sent: 1300,
              failed: 50,
            },
            {
              date: "2024-01-02",
              delivered: 1350,
              read: 1100,
              sent: 1400,
              failed: 50,
            },
            {
              date: "2024-01-03",
              delivered: 1200,
              read: 950,
              sent: 1250,
              failed: 50,
            },
          ],
          summary: {
            total_sent: 3950,
            total_delivered: 3800,
            total_read: 3030,
            total_failed: 150,
            delivery_rate: 96.2,
            read_rate: 79.7,
          },
        },
        fallback: true,
      }),
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/interakt/analytics/summary:
 *   get:
 *     tags:
 *       - Analytics
 *     summary: Get Analytics Summary
 *     description: Gets a summary of message analytics with key metrics like delivery rate, read rate, and total messages.
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: integer
 *         description: Start timestamp (Unix timestamp)
 *         example: 1693506600
 *       - in: query
 *         name: end
 *         schema:
 *           type: integer
 *         description: End timestamp (Unix timestamp)
 *         example: 1706725800
 *     responses:
 *       200:
 *         description: Analytics summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total_sent:
 *                       type: integer
 *                     total_delivered:
 *                       type: integer
 *                     total_read:
 *                       type: integer
 *                     total_failed:
 *                       type: integer
 *                     delivery_rate:
 *                       type: number
 *                       format: float
 *                     read_rate:
 *                       type: number
 *                       format: float
 */
// GET /api/interakt/analytics/summary - Analytics Summary
router.get("/analytics/summary", authenticateToken, async (req, res, next) => {
  try {
    const querySchema = z.object({
      start: z.coerce.number().optional(),
      end: z.coerce.number().optional(),
    });

    const query = querySchema.parse(req.query);

    const data = await withFallback({
      feature: "getAnalyticsSummary",
      attempt: async () => {
        const analytics = await interaktClient.getMessageAnalytics({
          ...query,
          fields: "analytics",
        });
        
        // Calculate summary from analytics data
        const summary = {
          total_sent: 0,
          total_delivered: 0,
          total_read: 0,
          total_failed: 0,
          delivery_rate: 0,
          read_rate: 0,
        };

        if (analytics.analytics?.data) {
          analytics.analytics.data.forEach((item: any) => {
            summary.total_sent += item.sent || 0;
            summary.total_delivered += item.delivered || 0;
            summary.total_read += item.read || 0;
            summary.total_failed += item.failed || 0;
          });

          summary.delivery_rate = summary.total_sent > 0 
            ? (summary.total_delivered / summary.total_sent) * 100 
            : 0;
          summary.read_rate = summary.total_delivered > 0 
            ? (summary.total_read / summary.total_delivered) * 100 
            : 0;
        }

        return { summary };
      },
      fallback: () => ({
        summary: {
          total_sent: 3950,
          total_delivered: 3800,
          total_read: 3030,
          total_failed: 150,
          delivery_rate: 96.2,
          read_rate: 79.7,
        },
        fallback: true,
      }),
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;




