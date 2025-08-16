import { Router } from "express";
import { z } from "zod";
import { interaktClient } from "../services/interaktClient";
import { withFallback } from "../utils/fallback";

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
 */

/**
 * @openapi
 * /api/interakt/webhook:
 *   get:
 *     tags:
 *       - Webhook
 *     summary: Webhook Verification
 *     description: Facebook webhook verification endpoint. Returns hub.challenge parameter for verification.
 *     parameters:
 *       - in: query
 *         name: hub.mode
 *         schema:
 *           type: string
 *         description: Webhook mode
 *       - in: query
 *         name: hub.verify_token
 *         schema:
 *           type: string
 *         description: Webhook verification token
 *       - in: query
 *         name: hub.challenge
 *         schema:
 *           type: string
 *         description: Challenge string to verify webhook
 *     responses:
 *       200:
 *         description: Webhook verified successfully
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: "CHALLENGE_STRING_HERE"
 */
// GET /api/interakt/webhook - Webhook verification
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Verify the webhook
  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    console.log("Webhook verification failed");
    res.sendStatus(403);
  }
});

/**
 * @openapi
 * /api/interakt/webhook:
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
// POST /api/interakt/webhook - Receive webhook updates
router.post("/webhook", (req, res) => {
  const body = req.body;

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
        }
      });
    });
  }

  res.sendStatus(200);
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
router.post("/test-message", async (req, res, next) => {
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
 *     description: Returns Interakt phone numbers or mocked data when fallback is active.
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order for phone numbers
 *     responses:
 *       200:
 *         description: List of phone numbers
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
 *                       verified_name:
 *                         type: string
 *                       display_phone_number:
 *                         type: string
 *                       quality_rating:
 *                         type: string
 *                       platform_type:
 *                         type: string
 */
// GET /api/interakt/phone-numbers
router.get("/phone-numbers", async (req, res, next) => {
  try {
    const querySchema = z.object({ sort: z.enum(["asc", "desc"]).optional() });
    const query = querySchema.parse(req.query);

    const data = await withFallback({
      feature: "getPhoneNumbers",
      attempt: () => interaktClient.getPhoneNumbers({ sort: query.sort }),
      fallback: async () => ({
        data: [
          {
            verified_name: "Mock Business",
            code_verification_status: "VERIFIED",
            display_phone_number: "+91 70000 00000",
            quality_rating: "GREEN",
            platform_type: "CLOUD_API",
            throughput: { level: "HIGH" },
            last_onboarded_time: new Date().toISOString(),
            id: "0000000000000",
          },
        ],
        paging: { cursors: { before: "", after: "" } },
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
// GET /api/interakt/templates
router.get("/templates", async (req, res, next) => {
  try {
    const query = z
      .object({
        fields: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(req.query);

    const data = await withFallback({
      feature: "getTemplates",
      attempt: () => interaktClient.getTemplates(query),
      fallback: async () => ({
        data: [
          {
            name: "shopzo invoice pdf",
            parameter_format: "POSITIONAL",
            components: [
              { type: "BODY", text: "Hello {{1}}", example: { body_text: [["Name"]] } },
            ],
            language: "en",
            status: "APPROVED",
            category: "UTILITY",
            id: "mock-1",
          },
          {
            name: "monsoon",
            parameter_format: "POSITIONAL",
            components: [{ type: "BODY", text: "Sale!" }],
            language: "en",
            status: "APPROVED",
            category: "MARKETING",
            id: "mock-2",
          },
        ],
        paging: { cursors: { before: "MAZDZD", after: "MjQZD" } },
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
// POST /api/interakt/templates
router.post("/templates", async (req, res, next) => {
  try {
    const bodySchema = z.object({
      name: z.string().min(1),
      language: z.string().min(1),
      category: z.enum(["AUTHENTICATION", "MARKETING", "UTILITY"]),
      components: z.array(z.any()),
      auto_category: z.boolean().optional(),
    });

    const body = bodySchema.parse(req.body);
    const data = await withFallback({
      feature: "createTextTemplate",
      attempt: () => interaktClient.createTextTemplate(body),
      fallback: () => ({ id: "mock-template-id", status: "PENDING", category: body.category, fallback: true }),
    });

    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/interakt/templates/media
router.post("/templates/media", async (req, res, next) => {
  try {
    const bodySchema = z.object({
      name: z.string().min(1),
      language: z.string().min(1),
      category: z.enum(["AUTHENTICATION", "MARKETING", "UTILITY"]),
      components: z.array(z.object({
        type: z.enum(["HEADER", "BODY", "FOOTER", "BUTTONS"]),
        format: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).optional(),
        text: z.string().optional(),
        example: z.object({
          header_handle: z.array(z.string()).optional(),
          body_text: z.array(z.array(z.string())).optional(),
        }).optional(),
      })),
      auto_category: z.boolean().optional(),
    });

    const body = bodySchema.parse(req.body);
    const data = await withFallback({
      feature: "createMediaTemplate",
      attempt: () => interaktClient.createTextTemplate(body), // Using same method for now
      fallback: () => ({ id: "mock-media-template-id", status: "PENDING", category: body.category, fallback: true }),
    });

    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

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
// GET /api/interakt/templates/:id
router.get("/templates/:id", async (req, res, next) => {
  try {
    const { id } = z.object({ id: z.string() }).parse(req.params);

    const data = await withFallback({
      feature: "getTemplateById",
      attempt: () => interaktClient.getTemplateById(id),
      fallback: async () => ({
        id,
        name: "mock template",
        parameter_format: "POSITIONAL",
        components: [
          { type: "BODY", text: "Hello {{1}}, this is a mock template." }
        ],
        language: "en",
        status: "APPROVED",
        category: "UTILITY",
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
// POST /api/interakt/messages
router.post("/messages", async (req, res, next) => {
  try {
    const payload = z
      .object({
        messaging_product: z.literal("whatsapp"),
        recipient_type: z.literal("individual").default("individual"),
        to: z.string(),
        type: z.literal("template"),
        template: z.any(),
      })
      .parse(req.body);

    const data = await withFallback({
      feature: "sendMediaTemplate",
      attempt: () => interaktClient.sendMediaTemplate(payload),
      fallback: () => ({
        messaging_product: "whatsapp",
        contacts: [{ input: payload.to, wa_id: payload.to }],
        messages: [{ id: "mock-msg-id", message_status: "accepted" }],
        fallback: true,
      }),
    });

    res.status(202).json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/interakt/messages/media
router.post("/messages/media", async (req, res, next) => {
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
router.post("/session-messages", async (req, res, next) => {
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

    res.status(202).json(data);
  } catch (err) {
    next(err);
  }
});

export default router;




