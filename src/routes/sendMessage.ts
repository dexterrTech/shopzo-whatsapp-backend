import { Router } from "express";
import { z } from "zod";
import { withFallback } from "../utils/fallback";
import { env } from "../config/env";
import { authenticateToken } from "../middleware/authMiddleware";
import { pool } from "../config/database";

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Send Message
 *     description: WhatsApp session/chat message sending APIs for different message types
 */

/**
 * @openapi
 * /api/send-message/{phone_number_id}/text:
 *   post:
 *     tags:
 *       - Send Message
 *     summary: Send Session Text Message
 *     description: Send a text message to a customer via WhatsApp Business API
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - recipient_type
 *               - to
 *               - type
 *               - text
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 description: Must be "whatsapp"
 *                 example: "whatsapp"
 *               recipient_type:
 *                 type: string
 *                 description: Type of recipient
 *                 example: "individual"
 *               to:
 *                 type: string
 *                 description: Customer phone number or WhatsApp ID
 *                 example: "+919999595313"
 *               type:
 *                 type: string
 *                 description: Message type
 *                 example: "text"
 *               text:
 *                 type: object
 *                 required:
 *                   - body
 *                 properties:
 *                   preview_url:
 *                     type: boolean
 *                     description: Whether to show URL preview
 *                     example: false
 *                   body:
 *                     type: string
 *                     description: Message text content
 *                     example: "This is a test message"
 *     responses:
 *       200:
 *         description: Text message sent successfully
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
 *                 fallback:
 *                   type: boolean
 */
// POST /api/send-message/:phone_number_id/text
router.post("/:phone_number_id/text", authenticateToken, async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "sendTextMessage",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/messages`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Send text message API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        messaging_product: "whatsapp",
        contacts: [
          {
            input: body.to || "+919999595313",
            wa_id: "919999595313"
          }
        ],
        messages: [
          {
            id: "wamid.HBgMOTE5OTk5NTk1MzEzFQIAERgSQUMwM0Y5RjNEMjIwQTFEMEE5AA=="
          }
        ],
        fallback: true
      })
    });

    // Save message to library on success
    try {
      const to = body?.to;
      const msgId = (data as any)?.messages?.[0]?.id;
      if (to && msgId) {
        await pool.query(
          `INSERT INTO messages (user_id, to_number, message_type, message_id, status, payload_json, response_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            (req as any)?.user?.id ?? null,
            String(to),
            'TEXT',
            String(msgId),
            'SENT',
            JSON.stringify(body),
            JSON.stringify(data)
          ]
        );
      }
    } catch (e) {
      console.warn('Failed to record message:', (e as any)?.message);
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/send-message:
 *   get:
 *     tags:
 *       - Send Message
 *     summary: List saved outbound messages (Message Library)
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Filter by to_number, message_id, or message_type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *     responses:
 *       200:
 *         description: List of messages
 */
router.get("/", authenticateToken, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(String((req.query as any)?.limit ?? '50'), 10) || 50, 1), 200);
    const offset = Math.max(parseInt(String((req.query as any)?.offset ?? '0'), 10) || 0, 0);
    const search = String((req.query as any)?.search ?? '').trim();

    let where = '';
    const params: any[] = [limit, offset];
    if (search) {
      where = `WHERE to_number ILIKE $3 OR message_id ILIKE $3 OR message_type ILIKE $3`;
      params.push(`%${search}%`);
    }

    const sql = `SELECT id, user_id, to_number, message_type, template_id, campaign_id, message_id, status, created_at
                 FROM messages ${where}
                 ORDER BY created_at DESC
                 LIMIT $1 OFFSET $2`;
    const result = await pool.query(sql, params);
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/send-message/{phone_number_id}/media:
 *   post:
 *     tags:
 *       - Send Message
 *     summary: Send Media Message
 *     description: Send media messages (image, video, audio, document, sticker) via WhatsApp Business API
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - recipient_type
 *               - to
 *               - type
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 description: Must be "whatsapp"
 *                 example: "whatsapp"
 *               recipient_type:
 *                 type: string
 *                 description: Type of recipient
 *                 example: "individual"
 *               to:
 *                 type: string
 *                 description: Customer phone number
 *                 example: "+919999595313"
 *               type:
 *                 type: string
 *                 description: Media type (image, video, audio, document, sticker)
 *                 example: "image"
 *               image:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: Media object ID (if uploaded to servers)
 *                     example: "MEDIA-OBJECT-ID"
 *                   link:
 *                     type: string
 *                     description: Public URL to media file
 *                     example: "https://example.com/image.jpg"
 *               video:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   link:
 *                     type: string
 *               audio:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   link:
 *                     type: string
 *               document:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   link:
 *                     type: string
 *               sticker:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   link:
 *                     type: string
 *     responses:
 *       200:
 *         description: Media message sent successfully
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
 *                 fallback:
 *                   type: boolean
 */
// POST /api/send-message/:phone_number_id/media
router.post("/:phone_number_id/media", authenticateToken, async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "sendMediaMessage",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/messages`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Send media message API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        messaging_product: "whatsapp",
        contacts: [
          {
            input: body.to || "+919999595313",
            wa_id: "919999595313"
          }
        ],
        messages: [
          {
            id: "wamid.HBgMOTE5OTk5NTk1MzEzFQIAERgSQUMwM0Y5RjNEMjIwQTFEMEE5AA=="
          }
        ],
        fallback: true
      })
    });

    try {
      const to = body?.to;
      const msgId = (data as any)?.messages?.[0]?.id;
      if (to && msgId) {
        await pool.query(
          `INSERT INTO messages (user_id, to_number, message_type, message_id, status, payload_json, response_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            (req as any)?.user?.id ?? null,
            String(to),
            'MEDIA',
            String(msgId),
            'SENT',
            JSON.stringify(body),
            JSON.stringify(data)
          ]
        );
      }
    } catch (e) {
      console.warn('Failed to record media message:', (e as any)?.message);
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/send-message/{phone_number_id}/catalog:
 *   post:
 *     tags:
 *       - Send Message
 *     summary: Send Catalog Message
 *     description: Send catalog template messages using approved catalog templates
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - recipient_type
 *               - to
 *               - type
 *               - interactive
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 description: Must be "whatsapp"
 *                 example: "whatsapp"
 *               recipient_type:
 *                 type: string
 *                 description: Type of recipient
 *                 example: "individual"
 *               to:
 *                 type: string
 *                 description: Customer phone number
 *                 example: "+919999595313"
 *               type:
 *                 type: string
 *                 description: Message type
 *                 example: "interactive"
 *               interactive:
 *                 type: object
 *                 required:
 *                   - type
 *                   - body
 *                   - action
 *                 properties:
 *                   type:
 *                     type: string
 *                     description: Interactive type
 *                     example: "catalog_message"
 *                   body:
 *                     type: object
 *                     required:
 *                       - text
 *                     properties:
 *                       text:
 *                         type: string
 *                         description: Message body text (max 1024 characters)
 *                         example: "Thanks for your order! Tell us what address you'd like this order delivered to."
 *                   footer:
 *                     type: object
 *                     properties:
 *                       text:
 *                         type: string
 *                         description: Footer text (max 60 characters)
 *                         example: "Best grocery deals on WhatsApp!"
 *                   action:
 *                     type: object
 *                     required:
 *                       - name
 *                       - parameters
 *                     properties:
 *                       name:
 *                         type: string
 *                         description: Action name
 *                         example: "catalog_message"
 *                       parameters:
 *                         type: object
 *                         properties:
 *                           thumbnail_product_retailer_id:
 *                             type: string
 *                             description: Product SKU for thumbnail
 *                             example: "2lc20305pt"
 *     responses:
 *       200:
 *         description: Catalog message sent successfully
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
 *                 fallback:
 *                   type: boolean
 */
// POST /api/send-message/:phone_number_id/catalog
router.post("/:phone_number_id/catalog", authenticateToken, async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "sendCatalogMessage",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/messages`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Send catalog message API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        messaging_product: "whatsapp",
        contacts: [
          {
            input: body.to || "+919999595313",
            wa_id: "919999595313"
          }
        ],
        messages: [
          {
            id: "wamid.HBgMOTE5OTk5NTk1MzEzFQIAERgSQUMwM0Y5RjNEMjIwQTFEMEE5AA=="
          }
        ],
        fallback: true
      })
    });

    try {
      const to = body?.to;
      const msgId = (data as any)?.messages?.[0]?.id;
      if (to && msgId) {
        await pool.query(
          `INSERT INTO messages (user_id, to_number, message_type, message_id, status, payload_json, response_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            (req as any)?.user?.id ?? null,
            String(to),
            'CATALOG',
            String(msgId),
            'SENT',
            JSON.stringify(body),
            JSON.stringify(data)
          ]
        );
      }
    } catch (e) {
      console.warn('Failed to record catalog message:', (e as any)?.message);
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/send-message/{phone_number_id}/single-product:
 *   post:
 *     tags:
 *       - Send Message
 *     summary: Send Single Product Message
 *     description: Send single product messages with catalog and product retailer ID
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - recipient_type
 *               - to
 *               - type
 *               - interactive
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 description: Must be "whatsapp"
 *                 example: "whatsapp"
 *               recipient_type:
 *                 type: string
 *                 description: Type of recipient
 *                 example: "individual"
 *               to:
 *                 type: string
 *                 description: Customer phone number
 *                 example: "+919999595313"
 *               type:
 *                 type: string
 *                 description: Message type
 *                 example: "interactive"
 *               interactive:
 *                 type: object
 *                 required:
 *                   - type
 *                   - action
 *                 properties:
 *                   type:
 *                     type: string
 *                     description: Interactive type
 *                     example: "product"
 *                   body:
 *                     type: object
 *                     properties:
 *                       text:
 *                         type: string
 *                         description: Optional body text
 *                         example: "optional body text"
 *                   footer:
 *                     type: object
 *                     properties:
 *                       text:
 *                         type: string
 *                         description: Optional footer text
 *                         example: "optional footer text"
 *                   action:
 *                     type: object
 *                     required:
 *                       - catalog_id
 *                       - product_retailer_id
 *                     properties:
 *                       catalog_id:
 *                         type: string
 *                         description: Catalog ID
 *                         example: "CATALOG_ID"
 *                       product_retailer_id:
 *                         type: string
 *                         description: Product retailer ID
 *                         example: "ID_TEST_ITEM_1"
 *     responses:
 *       200:
 *         description: Single product message sent successfully
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
 *                 fallback:
 *                   type: boolean
 */
// POST /api/send-message/:phone_number_id/single-product
router.post("/:phone_number_id/single-product", authenticateToken, async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "sendSingleProductMessage",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/messages`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Send single product message API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        messaging_product: "whatsapp",
        contacts: [
          {
            input: body.to || "+919999595313",
            wa_id: "919999595313"
          }
        ],
        messages: [
          {
            id: "wamid.HBgMOTE5OTk5NTk1MzEzFQIAERgSQUMwM0Y5RjNEMjIwQTFEMEE5AA=="
          }
        ],
        fallback: true
      })
    });

    try {
      const to = body?.to;
      const msgId = (data as any)?.messages?.[0]?.id;
      if (to && msgId) {
        await pool.query(
          `INSERT INTO messages (user_id, to_number, message_type, message_id, status, payload_json, response_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            (req as any)?.user?.id ?? null,
            String(to),
            'SINGLE_PRODUCT',
            String(msgId),
            'SENT',
            JSON.stringify(body),
            JSON.stringify(data)
          ]
        );
      }
    } catch (e) {
      console.warn('Failed to record single product message:', (e as any)?.message);
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/send-message/{phone_number_id}/multi-product:
 *   post:
 *     tags:
 *       - Send Message
 *     summary: Send Multi-Product Message
 *     description: Send multi-product messages with catalog sections and product lists
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - recipient_type
 *               - to
 *               - type
 *               - interactive
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 description: Must be "whatsapp"
 *                 example: "whatsapp"
 *               recipient_type:
 *                 type: string
 *                 description: Type of recipient
 *                 example: "individual"
 *               to:
 *                 type: string
 *                 description: Customer phone number
 *                 example: "+919999595313"
 *               type:
 *                 type: string
 *                 description: Message type
 *                 example: "interactive"
 *               interactive:
 *                 type: object
 *                 required:
 *                   - type
 *                   - header
 *                   - action
 *                 properties:
 *                   type:
 *                     type: string
 *                     description: Interactive type
 *                     example: "product_list"
 *                   header:
 *                     type: object
 *                     required:
 *                       - type
 *                       - text
 *                     properties:
 *                       type:
 *                         type: string
 *                         description: Header type
 *                         example: "text"
 *                       text:
 *                         type: string
 *                         description: Header content
 *                         example: "header-content"
 *                   body:
 *                     type: object
 *                     properties:
 *                       text:
 *                         type: string
 *                         description: Body content
 *                         example: "body-content"
 *                   footer:
 *                     type: object
 *                     properties:
 *                       text:
 *                         type: string
 *                         description: Footer content
 *                         example: "footer-content"
 *                   action:
 *                     type: object
 *                     required:
 *                       - catalog_id
 *                       - sections
 *                     properties:
 *                       catalog_id:
 *                         type: string
 *                         description: Catalog ID
 *                         example: "CATALOG_ID"
 *                       sections:
 *                         type: array
 *                         items:
 *                           type: object
 *                           required:
 *                             - title
 *                             - product_items
 *                           properties:
 *                             title:
 *                               type: string
 *                               description: Section title
 *                               example: "section-title"
 *                             product_items:
 *                               type: array
 *                               items:
 *                                 type: object
 *                                 required:
 *                                   - product_retailer_id
 *                                 properties:
 *                                   product_retailer_id:
 *                                     type: string
 *                                     description: Product SKU in catalog
 *                                     example: "product-SKU-in-catalog"
 *     responses:
 *       200:
 *         description: Multi-product message sent successfully
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
 *                 fallback:
 *                   type: boolean
 */
// POST /api/send-message/:phone_number_id/multi-product
router.post("/:phone_number_id/multi-product", authenticateToken, async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "sendMultiProductMessage",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/messages`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Send multi-product message API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        messaging_product: "whatsapp",
        contacts: [
          {
            input: body.to || "+919999595313",
            wa_id: "919999595313"
          }
        ],
        messages: [
          {
            id: "wamid.HBgMOTE5OTk5NTk1MzEzFQIAERgSQUMwM0Y5RjNEMjIwQTFEMEE5AA=="
          }
        ],
        fallback: true
      })
    });

    try {
      const to = body?.to;
      const msgId = (data as any)?.messages?.[0]?.id;
      if (to && msgId) {
        await pool.query(
          `INSERT INTO messages (user_id, to_number, message_type, message_id, status, payload_json, response_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            (req as any)?.user?.id ?? null,
            String(to),
            'MULTI_PRODUCT',
            String(msgId),
            'SENT',
            JSON.stringify(body),
            JSON.stringify(data)
          ]
        );
      }
    } catch (e) {
      console.warn('Failed to record multi product message:', (e as any)?.message);
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/send-message/{phone_number_id}/reply:
 *   post:
 *     tags:
 *       - Send Message
 *     summary: Message Replies
 *     description: Send messages as replies to previous messages in a conversation
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - context
 *               - to
 *               - type
 *               - text
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 description: Must be "whatsapp"
 *                 example: "whatsapp"
 *               context:
 *                 type: object
 *                 required:
 *                   - message_id
 *                 properties:
 *                   message_id:
 *                     type: string
 *                     description: ID of the message to reply to
 *                     example: "MESSAGE_ID"
 *               to:
 *                 type: string
 *                 description: Customer phone number or WhatsApp ID
 *                 example: "+919999595313"
 *               type:
 *                 type: string
 *                 description: Message type
 *                 example: "text"
 *               text:
 *                 type: object
 *                 required:
 *                   - body
 *                 properties:
 *                   preview_url:
 *                     type: boolean
 *                     description: Whether to show URL preview
 *                     example: false
 *                   body:
 *                     type: string
 *                     description: Reply message content
 *                     example: "your-text-message-content"
 *     responses:
 *       200:
 *         description: Reply message sent successfully
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
 *                 fallback:
 *                   type: boolean
 */
// POST /api/send-message/:phone_number_id/reply
router.post("/:phone_number_id/reply", authenticateToken, async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "sendReplyMessage",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/messages`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Send reply message API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        messaging_product: "whatsapp",
        contacts: [
          {
            input: body.to || "+919999595313",
            wa_id: "919999595313"
          }
        ],
        messages: [
          {
            id: "wamid.HBgMOTE5OTk5NTk1MzEzFQIAERgSQUMwM0Y5RjNEMjIwQTFEMEE5AA=="
          }
        ],
        fallback: true
      })
    });

    try {
      const to = body?.to;
      const msgId = (data as any)?.messages?.[0]?.id;
      if (to && msgId) {
        await pool.query(
          `INSERT INTO messages (user_id, to_number, message_type, message_id, status, payload_json, response_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            (req as any)?.user?.id ?? null,
            String(to),
            'REPLY',
            String(msgId),
            'SENT',
            JSON.stringify(body),
            JSON.stringify(data)
          ]
        );
      }
    } catch (e) {
      console.warn('Failed to record reply message:', (e as any)?.message);
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/send-message/{phone_number_id}/mark-read:
 *   post:
 *     tags:
 *       - Send Message
 *     summary: Mark Messages as READ
 *     description: Mark incoming messages as read by changing their status
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messaging_product
 *               - status
 *               - message_id
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 description: Must be "whatsapp"
 *                 example: "whatsapp"
 *               status:
 *                 type: string
 *                 description: Message status
 *                 example: "read"
 *               message_id:
 *                 type: string
 *                 description: ID of the message to mark as read
 *                 example: "MESSAGE_ID"
 *     responses:
 *       200:
 *         description: Message marked as read successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 fallback:
 *                   type: boolean
 */
// POST /api/send-message/:phone_number_id/mark-read
router.post("/:phone_number_id/mark-read", authenticateToken, async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "markMessageAsRead",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/messages`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Mark message as read API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        success: true,
        fallback: true
      })
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
/**
 * @openapi
 * /api/send-message/export:
 *   get:
 *     tags:
 *       - Send Message
 *     summary: Export sent messages as CSV
 *     description: Downloads CSV of recorded outbound messages
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10000
 *         description: Max rows to export
 *     responses:
 *       200:
 *         description: CSV file
 */
router.get("/export", authenticateToken, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(String((req.query as any)?.limit ?? '1000'), 10) || 1000, 1), 10000);
    const result = await pool.query(
      `SELECT id, user_id, to_number, message_type, template_id, campaign_id, message_id, status, created_at
       FROM messages ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    const headers = ['id','user_id','to_number','message_type','template_id','campaign_id','message_id','status','created_at'];
    const rows = result.rows.map((r: any) => headers.map((h) => {
      const v = r[h];
      const s = v === null || v === undefined ? '' : String(v);
      const needsQuotes = s.includes(',') || s.includes('\n') || s.includes('"');
      const escaped = s.replace(/"/g, '""');
      return needsQuotes ? `"${escaped}"` : escaped;
    }).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="messages.csv"');
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
});
