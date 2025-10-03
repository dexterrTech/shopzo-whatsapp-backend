import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/authMiddleware";
import { pool } from "../config/database";
import { prisma } from "../lib/prisma";
import { upsertBillingLog, holdWalletInSuspenseForBilling } from "../services/billingService";
import { env } from "../config/env";

const router = Router();

// Types for campaign and message tracking
export interface Campaign {
  id: string;
  name: string;
  trigger: "IMMEDIATE" | "SCHEDULED";
  audienceType: "ALL" | "SEGMENTED" | "QUICK";
  messageType: "TEMPLATE" | "REGULAR" | "BOT";
  templateId?: string;
  message?: string;
  audienceSize: number;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "FAILED";
  createdAt: string;
  scheduledAt?: string;
  processedAt?: string;
  completedAt?: string;
  userId: number;
}

export interface MessageLog {
  id: string;
  campaignId: string;
  to: string;
  templateName: string;
  languageCode: string;
  messageId: string;
  status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  errorMessage?: string;
  userId: number;
  createdAt: string;
}

/**
 * @swagger
 * /api/send-template/campaigns:
 *   post:
 *     tags:
 *       - Send Template
 *     summary: Create a new campaign
 *     description: Creates a new campaign for sending template messages
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - trigger
 *               - audienceType
 *               - messageType
 *               - audienceSize
 *             properties:
 *               name:
 *                 type: string
 *                 description: Campaign name
 *               trigger:
 *                 type: string
 *                 enum: ["IMMEDIATE", "SCHEDULED"]
 *                 description: When to trigger the campaign
 *               audienceType:
 *                 type: string
 *                 enum: ["ALL", "SEGMENTED", "QUICK"]
 *                 description: Type of audience selection
 *               messageType:
 *                 type: string
 *                 enum: ["TEMPLATE", "REGULAR", "BOT"]
 *                 description: Type of message to send
 *               templateId:
 *                 type: string
 *                 description: Template ID if using template message
 *               message:
 *                 type: string
 *                 description: Custom message if using regular message
 *               audienceSize:
 *                 type: number
 *                 description: Number of recipients
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *                 description: Scheduled time for campaign
 *     responses:
 *       201:
 *         description: Campaign created successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
// POST /api/send-template/campaigns - Create new campaign
router.post("/campaigns", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const bodySchema = z.object({
      name: z.string().min(1),
      trigger: z.enum(["IMMEDIATE", "SCHEDULED"]),
      audienceType: z.enum(["ALL", "SEGMENTED", "QUICK"]),
      messageType: z.enum(["TEMPLATE", "REGULAR", "BOT"]),
      templateId: z.string().optional(),
      message: z.string().optional(),
      audienceSize: z.number().positive(),
      scheduledAt: z.string().optional(),
    });

    const body = bodySchema.parse(req.body);

    // Validate required fields based on message type
    if (body.messageType === "TEMPLATE" && !body.templateId) {
      return res.status(400).json({
        success: false,
        message: "Template ID is required for template messages"
      });
    }

    if (body.messageType === "REGULAR" && !body.message) {
      return res.status(400).json({
        success: false,
        message: "Message content is required for regular messages"
      });
    }

    if (body.trigger === "SCHEDULED" && !body.scheduledAt) {
      return res.status(400).json({
        success: false,
        message: "Scheduled time is required for scheduled campaigns"
      });
    }

    const client = await pool.connect();
    try {
      // Create campaign record
      const campaignResult = await client.query(
        `INSERT INTO campaigns (
          name, trigger_type, audience_type, message_type, template_id, 
          message_content, audience_size, scheduled_at, status, user_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING *`,
        [
          body.name,
          body.trigger,
          body.audienceType,
          body.messageType,
          body.templateId || null,
          body.message || null,
          body.audienceSize,
          body.scheduledAt ? new Date(body.scheduledAt) : null,
          body.trigger === "IMMEDIATE" ? "ACTIVE" : "DRAFT",
          userId
        ]
      );

      const campaign = campaignResult.rows[0];

      // If immediate campaign, start processing
      if (body.trigger === "IMMEDIATE") {
        // Update status to processing
        await client.query(
          'UPDATE campaigns SET status = $1, processed_at = NOW() WHERE id = $2',
          ['PROCESSING', campaign.id]
        );
      }

      res.status(201).json({
        success: true,
        data: {
          id: campaign.id,
          name: campaign.name,
          trigger: campaign.trigger_type,
          audienceType: campaign.audience_type,
          messageType: campaign.message_type,
          templateId: campaign.template_id,
          message: campaign.message_content,
          audienceSize: campaign.audience_size,
          status: campaign.status,
          createdAt: campaign.created_at,
          scheduledAt: campaign.scheduled_at,
          userId: campaign.user_id
        },
        message: "Campaign created successfully"
      });

    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('Error creating campaign:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while creating campaign',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/send-template/send:
 *   post:
 *     tags:
 *       - Send Template
 *     summary: Send template message to contacts
 *     description: Sends a template message to multiple contacts and logs the results
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - campaignId
 *               - contacts
 *               - templateName
 *               - languageCode
 *             properties:
 *               campaignId:
 *                 type: string
 *                 description: Campaign ID
 *               contacts:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     whatsappNumber:
 *                       type: string
 *                 description: Array of contacts to send to
 *               templateName:
 *                 type: string
 *                 description: Name of the template to send
 *               languageCode:
 *                 type: string
 *                 description: Language code for the template
 *               parameters:
 *                 type: array
 *                 description: Optional parameters for the template
 *     responses:
 *       200:
 *         description: Messages sent successfully
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
// POST /api/send-template/send - Send template messages to contacts
router.post("/send", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const bodySchema = z.object({
      campaignId: z.string(),
      phoneNumbers: z.array(z.string()).optional(),
      contactIds: z.array(z.string()).optional(),
      templateName: z.string(),
      languageCode: z.string().min(2).max(5),
      templateCategory: z.enum(['UTILITY','MARKETING','AUTHENTICATION','SERVICE']).optional(),
      parameters: z.array(z.any()).optional(),
      headerMedia: z.object({
        type: z.enum(['image','video','document']),
        link: z.string().url().optional(),
        id: z.string().optional(),
      }).optional(),
      // Accept null/undefined and coerce later
      bodyParams: z.array(z.union([z.string(), z.null(), z.undefined()])).optional(),
      bodyParamsPerRecipient: z.array(z.array(z.union([z.string(), z.null(), z.undefined()]))).optional(),
      variableMapping: z.record(z.string(), z.object({
        field: z.string(),
        fallback: z.string().optional().default("")
      })).optional(),
      // Explicit per-card text values for carousel placeholders: key 'card_<index>_<n>' -> text
      carouselTextVars: z.record(z.string(), z.string()).optional(),
      // Carousel template support
      carouselCards: z.array(z.object({
        card_index: z.number(),
        components: z.array(z.object({
          type: z.enum(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']),
          parameters: z.array(z.object({
            type: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'payload']),
            text: z.string().optional(),
            image: z.object({
              link: z.string().url().optional(),
              id: z.string().optional()
            }).optional(),
            video: z.object({
              link: z.string().url().optional(),
              id: z.string().optional()
            }).optional(),
            document: z.object({
              link: z.string().url().optional(),
              id: z.string().optional()
            }).optional(),
            payload: z.string().optional()
          }))
        }))
      })).optional(),
      // Location header support
      locationParameters: z.object({
        longitude: z.number(),
        latitude: z.number(),
        name: z.string().optional().default(''),
        address: z.string().optional().default('')
      }).optional(),
    }).refine((b) => (b.phoneNumbers && b.phoneNumbers.length) || (b.contactIds && b.contactIds.length), {
      message: 'Provide phoneNumbers or contactIds'
    });

    const body = bodySchema.parse(req.body);

           // Get user's WhatsApp setup from database
       const client = await pool.connect();
       try {
         const setupResult = await client.query(
           'SELECT waba_id, phone_number_id FROM whatsapp_setups WHERE user_id = $1 AND waba_id IS NOT NULL AND phone_number_id IS NOT NULL',
           [userId]
         );

         if (setupResult.rows.length === 0 || !setupResult.rows[0].waba_id || !setupResult.rows[0].phone_number_id) {
           return res.status(400).json({
             success: false,
             message: 'WhatsApp setup not completed. Please complete WhatsApp Business setup with both WABA ID and Phone Number ID.',
             code: 'WHATSAPP_SETUP_REQUIRED'
           });
         }

         const wabaId = setupResult.rows[0].waba_id;
         const phoneNumberId = setupResult.rows[0].phone_number_id;
         const accessToken = env.INTERAKT_ACCESS_TOKEN;

                console.log('Debug - WhatsApp Setup:', {
           wabaId: wabaId,
           phoneNumberId: phoneNumberId,
           accessTokenExists: !!accessToken,
           userId: userId
         });

             if (!accessToken) {
         return res.status(500).json({
           success: false,
           message: 'Server configuration error: Interakt access token not configured'
         });
       }

       // Validate WABA ID and Phone Number ID format
       if (!wabaId || typeof wabaId !== 'string' || wabaId.length < 10) {
         return res.status(400).json({
           success: false,
           message: 'Invalid WABA ID format. Please check your WhatsApp Business setup.',
           wabaId: wabaId
         });
       }

       if (!phoneNumberId || typeof phoneNumberId !== 'string' || phoneNumberId.length < 5) {
         return res.status(400).json({
           success: false,
           message: 'Invalid Phone Number ID format. Please check your WhatsApp Business setup.',
           phoneNumberId: phoneNumberId
         });
       }

      // Verify campaign exists and belongs to user (keep SQL here for now if no Prisma model)
      const campaignResult = await pool.query(
        'SELECT * FROM campaigns WHERE id = $1 AND user_id = $2',
        [body.campaignId, userId]
      );

      if (campaignResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }

      const campaign = campaignResult.rows[0];

             // Use the original template name as provided by the user
      // Interakt expects the exact template name as it appears in their system
      const templateName = body.templateName;

      // Determine category: prefer explicit from client, then campaign.template_id -> templates table,
      // then templates by name, then Interakt fetch, then heuristics
      let detectedCategory: 'utility' | 'marketing' | 'authentication' | 'service' | null = null;
      if (body.templateCategory) {
        const c = body.templateCategory.toLowerCase();
        detectedCategory = (c as any) as 'utility' | 'marketing' | 'authentication' | 'service';
      }
      try {
        if (campaign?.template_id) {
          const tRes = await client.query('SELECT name, category FROM templates WHERE id = $1 LIMIT 1', [campaign.template_id]);
          const t = tRes.rows[0];
          if (t?.category) {
            const c = String(t.category).toLowerCase();
            if (c.includes('market')) detectedCategory = 'marketing';
            else if (c.includes('auth')) detectedCategory = 'authentication';
            else if (c.includes('service')) detectedCategory = 'service';
            else detectedCategory = 'utility';
          }
        }
      } catch (e) {
        console.log('Debug - Campaign template category lookup failed (continuing):', e);
      }
      if (!detectedCategory) {
        try {
          const catRes = await client.query(
            'SELECT category FROM templates WHERE name = $1 LIMIT 1',
            [templateName]
          );
          const dbCat = String(catRes.rows[0]?.category || '').toLowerCase();
          if (dbCat) {
            if (dbCat.includes('market')) detectedCategory = 'marketing';
            else if (dbCat.includes('auth')) detectedCategory = 'authentication';
            else if (dbCat.includes('service')) detectedCategory = 'service';
            else detectedCategory = 'utility';
          }
        } catch (e) {
          console.log('Debug - DB template category lookup failed (continuing):', e);
        }
      }

      // First, let's check the template status from Interakt
      console.log('Debug - Checking template status for:', templateName);
      try {
        const templateCheckResponse = await fetch(
          `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/message_templates`,
          {
            method: 'GET',
            headers: {
              'x-access-token': accessToken,
              'x-waba-id': wabaId,
              'Content-Type': 'application/json'
            }
          }
        );

        if (templateCheckResponse.ok) {
          const templateData = await templateCheckResponse.json();
          console.log('Debug - Available templates:', JSON.stringify(templateData, null, 2));
          
          // Find our specific template (support multiple possible response shapes)
          const list = (templateData?.data?.data) || templateData?.data || templateData?.templates || [];
          const ourTemplate = Array.isArray(list) ? list.find((t: any) => t?.name === templateName) : undefined;
          if (ourTemplate) {
            console.log('Debug - Our template status:', {
              name: ourTemplate.name,
              status: ourTemplate.status,
              category: ourTemplate.category,
              language: ourTemplate.language
            });
            if (!detectedCategory) {
              const cat = String(ourTemplate.category || '').toLowerCase();
              if (cat.includes('market')) detectedCategory = 'marketing';
              else if (cat.includes('auth')) detectedCategory = 'authentication';
              else if (cat.includes('service')) detectedCategory = 'service';
              else detectedCategory = 'utility';
            }
          } else {
            console.log('Debug - Template not found in available templates');
          }
        } else {
          console.log('Debug - Failed to fetch templates:', templateCheckResponse.status, templateCheckResponse.statusText);
        }
      } catch (error) {
        console.log('Debug - Error checking template status:', error);
      }

      const results = [];
      const messageLogs = [];

      // Resolve recipients
      let recipientNumbers: string[] = Array.isArray(body.phoneNumbers) ? [...body.phoneNumbers] : [];
      if ((!recipientNumbers || recipientNumbers.length === 0) && Array.isArray((body as any).contactIds) && (body as any).contactIds.length > 0) {
        try {
          const ids = (body as any).contactIds.map((id: string) => Number(id)).filter((n: number) => !Number.isNaN(n));
          if (ids.length > 0) {
            const placeholders = ids.map((_id: number, i: number) => `$${i + 1}`).join(',');
            const q = `SELECT whatsapp_number, phone FROM contacts WHERE user_id = $${ids.length + 1} AND id IN (${placeholders})`;
            const r = await client.query(q, [...ids, userId]);
            recipientNumbers = r.rows
              .map((row: any) => (row.whatsapp_number || row.phone || '').toString())
              .filter((v: string) => v && v.trim().length > 0);
          }
        } catch (e) {
          console.warn('Failed to resolve contactIds to phone numbers', e);
        }
      }
      if (!recipientNumbers || recipientNumbers.length === 0) {
        return res.status(400).json({ success: false, message: 'No recipients to send' });
      }

             // Send messages to each contact
      for (let i = 0; i < recipientNumbers.length; i++) {
        const phoneNumber = recipientNumbers[i];
         // Ensure phone number is in international format
         let formattedPhoneNumber = phoneNumber;
         if (!formattedPhoneNumber.startsWith('+')) {
           // If it starts with country code (91), add +
           if (formattedPhoneNumber.startsWith('91')) {
             formattedPhoneNumber = '+' + formattedPhoneNumber;
           } else {
             // Assume it's an Indian number and add +91
             formattedPhoneNumber = '+91' + formattedPhoneNumber;
           }
         }
         
         try {
           
                       // Prepare message payload for Interakt - using exact format from user
            const messagePayload = {
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: formattedPhoneNumber,
              type: "template",
              template: {
                name: templateName,
                language: {
                  code: body.languageCode.split('_')[0] // Convert 'en_US' to 'en'
                }
              }
            };

            console.log('Debug - Full message payload:', JSON.stringify(messagePayload, null, 2));

            if (body.parameters && body.parameters.length > 0) {
              (messagePayload.template as any).components = body.parameters;
            } else if (body.carouselCards && body.carouselCards.length > 0) {
              // Handle carousel template
              const builtComponents: any[] = [];

              // Resolve BODY parameters (support variableMapping like non-carousel flow)
              let resolvedBodyParams: string[] | undefined;
              if (body.variableMapping && Array.isArray((body as any).contactIds) && (body as any).contactIds.length > 0) {
                try {
                  const cid = Number((body as any).contactIds[i]);
                  if (!Number.isNaN(cid)) {
                    const cr = await client.query('SELECT * FROM contacts WHERE id = $1 AND user_id = $2 LIMIT 1', [cid, userId]);
                    const contact = cr.rows[0] || {};
                    const entries = Object.entries(body.variableMapping).sort(([a],[b]) => Number(a) - Number(b));
                    const arr: string[] = [];
                    for (const [k, cfg] of entries) {
                      const n = Number(k);
                      const val = contact[cfg.field as keyof typeof contact];
                      const text = (val === undefined || val === null || String(val).trim() === '') ? (cfg.fallback || '') : String(val);
                      arr[n - 1] = text;
                    }
                    resolvedBodyParams = arr;
                  }
                } catch {}
              }
              // Merge per-recipient and uniform bodyParams
              if (body.bodyParamsPerRecipient && Array.isArray(body.bodyParamsPerRecipient[i])) {
                const perRec = (body.bodyParamsPerRecipient[i] as any[]).map((v) => (v ?? '')) as string[];
                if (!resolvedBodyParams) {
                  resolvedBodyParams = perRec;
                } else {
                  for (let j = 0; j < perRec.length; j++) {
                    if (resolvedBodyParams[j] === undefined || resolvedBodyParams[j] === '') {
                      resolvedBodyParams[j] = perRec[j];
                    }
                  }
                }
              }
              if (body.bodyParams && body.bodyParams.length > 0) {
                const uniform = (body.bodyParams as any[]).map((v) => (v ?? '')) as string[];
                if (!resolvedBodyParams) {
                  resolvedBodyParams = uniform;
                } else {
                  for (let j = 0; j < uniform.length; j++) {
                    if (resolvedBodyParams[j] === undefined || resolvedBodyParams[j] === '') {
                      resolvedBodyParams[j] = uniform[j];
                    }
                  }
                }
              }
              if (resolvedBodyParams && resolvedBodyParams.length > 0) {
                const denseParams = Array.from({ length: resolvedBodyParams.length }, (_, idx) => {
                  const v = (resolvedBodyParams as any)[idx];
                  if (v === null || v === undefined) return '';
                  const s = typeof v === 'string' ? v : String(v);
                  return s;
                });
                const sanitizedParams = denseParams.map((txt) => {
                  const raw = typeof txt === 'string' ? txt : '';
                  const isConst = raw.startsWith('CONST:');
                  const val = isConst ? raw.replace(/^CONST:/, '') : raw;
                  const t = val.trim();
                  return t.length > 0 ? t : '-';
                });
                builtComponents.push({
                  type: 'BODY',
                  parameters: sanitizedParams.map((txt) => ({ type: 'TEXT', text: txt }))
                });
              }

              // Add CAROUSEL component
              builtComponents.push({
                type: 'CAROUSEL',
                cards: body.carouselCards.map((card: any) => ({
                  card_index: card.card_index,
                  components: (card.components || []).map((comp: any) => {
                    // Normalize BODY components to parameters expected by Interakt
                    if (String(comp.type).toUpperCase() === 'BODY') {
                      // Prefer deriving from comp.text placeholders if present
                      const text: string = typeof comp.text === 'string' ? comp.text : '';
                      const matches = text.match(/\{\{\d+\}\}/g) || [];
                      if (matches.length > 0) {
                        // Build values using variableMapping keys like card_<index>_<n>
                        const indices = matches.map((m) => Number(m.replace(/[^\d]/g, '')));
                        const maxIdx = indices.reduce((max, n) => Math.max(max, n), 0);
                        const params = Array.from({ length: maxIdx }, (_, k) => {
                          const n = k + 1;
                          const key = `card_${card.card_index}_${n}`;
                          const explicit = (body as any).carouselTextVars ? (body as any).carouselTextVars[key] : undefined;
                          const cfg = (body as any).variableMapping ? (body as any).variableMapping[key] : undefined;
                          const rawVal = explicit ?? cfg?.text ?? '';
                          const val = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal ?? '').trim();
                          return { type: 'text', text: val.length > 0 ? (explicit ?? (cfg?.text as string)) : '-' };
                        });
                        return { type: 'BODY', parameters: params };
                      }

                      // No placeholders detected; if a literal text was given, send as single TEXT param
                      const literal = (text || '').trim();
                      return {
                        type: 'BODY',
                        parameters: [{ type: 'text', text: literal.length > 0 ? text : '-' }]
                      };
                    }

                    // Non-BODY components: pass through with sanitized parameters
                    return {
                      type: String(comp.type).toUpperCase(),
                      parameters: Array.isArray(comp.parameters) ? comp.parameters.map((param: any) => {
                        const paramObj: any = { type: param.type };
                        if (param.text) paramObj.text = param.text;
                        if (param.image) paramObj.image = param.image;
                        if (param.video) paramObj.video = param.video;
                        if (param.document) paramObj.document = param.document;
                        if (param.payload) paramObj.payload = param.payload;
                        return paramObj;
                      }) : []
                    };
                  })
                }))
              });

              try {
                console.log('Debug - Built carousel components:', JSON.stringify(builtComponents, null, 2));
              } catch {}
              
              (messagePayload.template as any).components = builtComponents;
            } else {
              const builtComponents: any[] = [];
              if (body.headerMedia) {
                const mediaType = body.headerMedia.type; // image | video | document
                const mediaPayload: any = {};
                if (body.headerMedia.id) mediaPayload.id = body.headerMedia.id;
                if (body.headerMedia.link) mediaPayload.link = body.headerMedia.link;
                builtComponents.push({
                  type: 'header',
                  parameters: [{ type: mediaType, [mediaType]: mediaPayload }]
                });
              }
              // LOCATION header
              if (body.locationParameters && typeof body.locationParameters.latitude === 'number' && typeof body.locationParameters.longitude === 'number') {
                builtComponents.push({
                  type: 'header',
                  parameters: [{
                    type: 'location',
                    location: {
                      latitude: body.locationParameters.latitude,
                      longitude: body.locationParameters.longitude,
                      name: body.locationParameters.name || '',
                      address: body.locationParameters.address || ''
                    }
                  }]
                });
              }
            // Resolve BODY parameters per recipient using variableMapping (preferred)
            // else fall back to uniform bodyParams
            let resolvedBodyParams: string[] | undefined;
            if (body.variableMapping && Array.isArray((body as any).contactIds) && (body as any).contactIds.length > 0) {
              try {
                const cid = Number((body as any).contactIds[i]);
                if (!Number.isNaN(cid)) {
                  const cr = await client.query('SELECT * FROM contacts WHERE id = $1 AND user_id = $2 LIMIT 1', [cid, userId]);
                  const contact = cr.rows[0] || {};
                  const entries = Object.entries(body.variableMapping).sort(([a],[b]) => Number(a) - Number(b));
                  const arr: string[] = [];
                  for (const [k, cfg] of entries) {
                    const n = Number(k);
                    const val = contact[cfg.field as keyof typeof contact];
                    const text = (val === undefined || val === null || String(val).trim() === '') ? (cfg.fallback || '') : String(val);
                    arr[n - 1] = text;
                  }
                  resolvedBodyParams = arr;
                }
              } catch {}
            }
            // Merge strategy: variableMapping wins for provided positions, but fill blanks from per-recipient or uniform bodyParams
            if (body.bodyParamsPerRecipient && Array.isArray(body.bodyParamsPerRecipient[i])) {
              const perRec = (body.bodyParamsPerRecipient[i] as any[]).map((v) => (v ?? '')) as string[];
              if (!resolvedBodyParams) {
                resolvedBodyParams = perRec;
              } else {
                for (let j = 0; j < perRec.length; j++) {
                  if (resolvedBodyParams[j] === undefined || resolvedBodyParams[j] === '') {
                    resolvedBodyParams[j] = perRec[j];
                  }
                }
              }
            }
            if (body.bodyParams && body.bodyParams.length > 0) {
              const uniform = (body.bodyParams as any[]).map((v) => (v ?? '')) as string[];
              if (!resolvedBodyParams) {
                resolvedBodyParams = uniform;
              } else {
                for (let j = 0; j < uniform.length; j++) {
                  if (resolvedBodyParams[j] === undefined || resolvedBodyParams[j] === '') {
                    resolvedBodyParams[j] = uniform[j];
                  }
                }
              }
            }
            if (resolvedBodyParams && resolvedBodyParams.length > 0) {
              // Densify sparse arrays and coerce null/undefined to empty strings
              const denseParams = Array.from({ length: resolvedBodyParams.length }, (_, idx) => {
                const v = (resolvedBodyParams as any)[idx];
                if (v === null || v === undefined) return '';
                const s = typeof v === 'string' ? v : String(v);
                return s;
              });
              // Support CONST: prefix for literal constants
              const sanitizedParams = denseParams.map((txt) => {
                const raw = typeof txt === 'string' ? txt : '';
                const isConst = raw.startsWith('CONST:');
                const val = isConst ? raw.replace(/^CONST:/, '') : raw;
                const t = val.trim();
                // Interakt rejects missing text value; ensure non-empty fallback
                return t.length > 0 ? t : '-';
              });
              builtComponents.push({
                type: 'body',
                parameters: sanitizedParams.map((txt) => ({ type: 'text', text: txt }))
              });
            }
            if (builtComponents.length > 0) {
              (messagePayload.template as any).components = builtComponents;
            }
          }

                                             // Call Interakt API to send template message
            console.log('Debug - Sending to Interakt:', {
              url: `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`,
              payload: messagePayload,
              templateName: templateName,
              languageCode: body.languageCode,
              languageCodeFormatted: body.languageCode.split('_')[0],
              phoneNumberId: phoneNumberId,
              wabaId: wabaId,
              headers: {
                'x-access-token': accessToken ? '***' : 'MISSING',
                'x-waba-id': wabaId,
                'Content-Type': 'application/json'
              }
            });
            
            const interaktResponse = await fetch(
              `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`,
              {
                method: 'POST',
                headers: {
                  'x-access-token': accessToken,
                  'x-waba-id': wabaId,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(messagePayload)
              }
            );

                     console.log('Debug - Interakt Response:', {
             status: interaktResponse.status,
             statusText: interaktResponse.statusText,
             headers: Object.fromEntries(interaktResponse.headers.entries())
           });
           
                       let interaktData;
            // Read response body only once
            const responseText = await interaktResponse.text();
            
            try {
              interaktData = JSON.parse(responseText);
              console.log('Debug - Interakt Response Data:', interaktData);
            } catch (parseError) {
              // If response is not JSON, use the text content
              console.log('Debug - Interakt Error Text:', responseText);
              interaktData = { error: responseText };
            }

                       if (interaktResponse.ok && !interaktData.error) {
              // Success - log message
              const messageId = interaktData.messages?.[0]?.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              
              console.log('Debug - Message sent successfully, checking delivery status for:', messageId);
              
              // Check message delivery status after a short delay
              setTimeout(async () => {
                try {
                  const statusResponse = await fetch(
                    `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages/${messageId}`,
                    {
                      method: 'GET',
                      headers: {
                        'x-access-token': accessToken,
                        'x-waba-id': wabaId,
                        'Content-Type': 'application/json'
                      }
                    }
                  );
                  
                  if (statusResponse.ok) {
                    const statusData = await statusResponse.json();
                    console.log('Debug - Message delivery status:', JSON.stringify(statusData, null, 2));
                  } else {
                    console.log('Debug - Failed to check message status:', statusResponse.status);
                  }
                } catch (error) {
                  console.log('Debug - Error checking message status:', error);
                }
              }, 5000); // Check after 5 seconds
              
              const messageLog = {
                campaignId: body.campaignId,
                to: formattedPhoneNumber,
                templateName: body.templateName,
                languageCode: body.languageCode,
                messageId: messageId,
                status: 'SENT',
                sentAt: new Date().toISOString(),
                userId: userId,
                createdAt: new Date().toISOString()
              } as any;

            messageLogs.push(messageLog);

              // Billing: upsert billing log and hold funds in suspense for this message
              try {
                let category: 'utility' | 'marketing' | 'authentication' | 'service' = detectedCategory || 'utility';
                let source: 'detected' | 'heuristic' = 'detected';
                if (!detectedCategory) {
                  const tn = String(body.templateName || '').toLowerCase();
                  if (tn.includes('market') || tn.includes('promo')) category = 'marketing';
                  else if (tn.includes('auth')) category = 'authentication';
                  else if (tn.includes('service')) category = 'service';
                  source = 'heuristic';
                }
                console.log('Billing category chosen (success path):', { templateName: body.templateName, detectedCategory, category, source });

                const ins = await upsertBillingLog({
                  userId,
                  conversationId: messageId,
                  category,
                  recipientNumber: formattedPhoneNumber,
                  startTime: new Date(),
                  endTime: new Date(),
                  billingStatus: 'pending',
                });
                console.log('Billing: upsertBillingLog success path result:', ins);
                if (ins) {
                  const amtRes = await client.query('SELECT amount_paise, amount_currency FROM billing_logs WHERE id = $1', [ins.id]);
                  const row = amtRes.rows[0];
                  console.log('Billing: fetched amount for hold (success path):', row);
                  if (row) {
                    await holdWalletInSuspenseForBilling({ userId, conversationId: messageId, amountPaise: row.amount_paise, currency: row.amount_currency });
                    console.log('Billing: holdWalletInSuspenseForBilling done (success path)');
                  }
                }
              } catch (e) {
                console.warn('Billing hold failed (success path):', e);
              }

            results.push({
              contactId: phoneNumber, // Store the original phone number as contactId
              status: 'success',
              messageId: messageLog.messageId,
              interaktResponse: interaktData
            });
          } else {
                         // Failed - log error
             const messageLog = {
               campaignId: body.campaignId,
               to: formattedPhoneNumber,
               templateName: body.templateName,
               languageCode: body.languageCode,
               messageId: `failed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
               status: 'FAILED',
               failedAt: new Date().toISOString(),
               errorMessage: `Interakt API error: ${interaktResponse.status} ${interaktResponse.statusText}`,
               userId: userId,
               createdAt: new Date().toISOString()
             };

            messageLogs.push(messageLog);

            // Billing: hold funds even if failed (charged on attempts)
            try {
              let category: 'utility' | 'marketing' | 'authentication' | 'service' = detectedCategory || 'utility';
              let source: 'detected' | 'heuristic' = 'detected';
              if (!detectedCategory) {
                const tn = String(body.templateName || '').toLowerCase();
                if (tn.includes('market') || tn.includes('promo')) category = 'marketing';
                else if (tn.includes('auth')) category = 'authentication';
                else if (tn.includes('service')) category = 'service';
                source = 'heuristic';
              }
              console.log('Billing category chosen (failure path):', { templateName: body.templateName, detectedCategory, category, source });

              const ins = await upsertBillingLog({
                userId,
                conversationId: (messageLog as any).messageId,
                category,
                recipientNumber: formattedPhoneNumber,
                startTime: new Date(),
                endTime: new Date(),
                billingStatus: 'pending',
              });
              console.log('Billing: upsertBillingLog failure path result:', ins);
              if (ins) {
                const amtRes = await client.query('SELECT amount_paise, amount_currency FROM billing_logs WHERE id = $1', [ins.id]);
                const row = amtRes.rows[0];
                console.log('Billing: fetched amount for hold (failure path):', row);
                if (row) {
                  await holdWalletInSuspenseForBilling({ userId, conversationId: (messageLog as any).messageId, amountPaise: row.amount_paise, currency: row.amount_currency });
                  console.log('Billing: holdWalletInSuspenseForBilling done (failure path)');
                }
              }
            } catch (e) {
              console.warn('Billing hold failed (failure path):', e);
            }

            results.push({
              contactId: phoneNumber, // Store the original phone number as contactId
              status: 'failed',
              error: `Interakt API error: ${interaktResponse.status} ${interaktResponse.statusText}`,
              interaktResponse: interaktData
            });
          }

        } catch (error: any) {
                     // Individual contact error
           const messageLog = {
             campaignId: body.campaignId,
             to: formattedPhoneNumber,
             templateName: body.templateName,
             languageCode: body.languageCode,
             messageId: `error-${Date.now()}-${Math.random().toString(36).slice(2)}`,
             status: 'FAILED',
             failedAt: new Date().toISOString(),
             errorMessage: error.message || 'Unknown error',
             userId: userId,
             createdAt: new Date().toISOString()
           };

          messageLogs.push(messageLog);

          // Billing: hold funds for attempted send when exception occurs
          try {
            let category: 'utility' | 'marketing' | 'authentication' | 'service' = detectedCategory || 'utility';
            let source: 'detected' | 'heuristic' = 'detected';
            if (!detectedCategory) {
              const tn = String(body.templateName || '').toLowerCase();
              if (tn.includes('market') || tn.includes('promo')) category = 'marketing';
              else if (tn.includes('auth')) category = 'authentication';
              else if (tn.includes('service')) category = 'service';
              source = 'heuristic';
            }
            console.log('Billing category chosen (exception path):', { templateName: body.templateName, detectedCategory, category, source });

            const ins = await upsertBillingLog({
              userId,
              conversationId: (messageLog as any).messageId,
              category,
              recipientNumber: formattedPhoneNumber,
              startTime: new Date(),
              endTime: new Date(),
              billingStatus: 'pending',
            });
            console.log('Billing: upsertBillingLog exception path result:', ins);
            if (ins) {
              const amtRes = await client.query('SELECT amount_paise, amount_currency FROM billing_logs WHERE id = $1', [ins.id]);
              const row = amtRes.rows[0];
              console.log('Billing: fetched amount for hold (exception path):', row);
              if (row) {
                await holdWalletInSuspenseForBilling({ userId, conversationId: (messageLog as any).messageId, amountPaise: row.amount_paise, currency: row.amount_currency });
                console.log('Billing: holdWalletInSuspenseForBilling done (exception path)');
              }
            }
          } catch (e) {
            console.warn('Billing hold failed (exception path):', e);
          }

          results.push({
            contactId: phoneNumber, // Store the original phone number as contactId
            status: 'failed',
            error: error.message || 'Unknown error'
          });
        }
      }

      // Insert message logs into database
      if (messageLogs.length > 0) {
        const values = messageLogs.map((log, index) => {
          const offset = index * 8;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
        }).join(', ');

        const flatValues = messageLogs.flatMap(log => [
          log.campaignId,
          log.to,
          log.templateName,
          log.languageCode,
          log.messageId,
          log.status,
          log.sentAt || log.failedAt || log.createdAt,
          log.userId
        ]);

        await client.query(
          `INSERT INTO message_logs (
            campaign_id, to_number, template_name, language_code, 
            message_id, status, sent_at, user_id
          ) VALUES ${values}`,
          flatValues
        );
      }

      // Update campaign status if all messages sent
      const successCount = results.filter(r => r.status === 'success').length;
      const totalCount = results.length;

      if (successCount === totalCount) {
        await client.query(
          'UPDATE campaigns SET status = $1, completed_at = NOW() WHERE id = $2',
          ['COMPLETED', body.campaignId]
        );
      } else if (successCount > 0) {
        await client.query(
          'UPDATE campaigns SET status = $1 WHERE id = $2',
          ['PARTIALLY_COMPLETED', body.campaignId]
        );
      } else {
        await client.query(
          'UPDATE campaigns SET status = $1 WHERE id = $2',
          ['FAILED', body.campaignId]
        );
      }

      res.json({
        success: true,
        data: {
          campaignId: body.campaignId,
          totalContacts: totalCount,
          successCount: successCount,
          failedCount: totalCount - successCount,
          results: results
        },
        message: `Campaign executed: ${successCount}/${totalCount} messages sent successfully`
      });

    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('Error sending template messages:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while sending template messages',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/send-template/cta:
 *   post:
 *     tags:
 *       - Send Template
 *     summary: Send a single template message with CTA button parameters
 *     description: Sends a template message using Interakt with a CTA button (URL sub_type) and optional body/header components
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - templateName
 *               - languageCode
 *             properties:
 *               to:
 *                 type: string
 *                 description: Recipient phone in international format, e.g. +919999999999 or 919999999999
 *               templateName:
 *                 type: string
 *               languageCode:
 *                 type: string
 *                 description: Language code, e.g. en, en_US (will be coerced to en)
 *               cta:
 *                 type: object
 *                 description: CTA button config (URL type)
 *                 properties:
 *                   index:
 *                     type: integer
 *                     description: Button index as per template (0-based)
 *                   sub_type:
 *                     type: string
 *                     enum: [url]
 *                   payload:
 *                     type: string
 *                     description: The dynamic part for URL button
 *               components:
 *                 type: array
 *                 description: Optional raw Interakt components to fully control payload
 *     responses:
 *       200:
 *         description: Message sent (accepted)
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
// POST /api/send-template/cta - Send one template with CTA button
router.post("/cta", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const bodySchema = z.object({
      to: z.string().min(5),
      templateName: z.string().min(1),
      languageCode: z.string().min(2),
      cta: z
        .object({
          index: z.coerce.number().int().min(0).default(0),
          sub_type: z.literal("url").default("url"),
          payload: z.string().min(1),
        })
        .optional(),
      components: z.array(z.any()).optional(),
    });

    const body = bodySchema.parse(req.body);

    // Get user's WhatsApp setup via ORM
    try {
      const setup = await (prisma as any).whatsappSetup.findFirst({
        where: {
          user_id: Number(userId),
          waba_id: { not: null },
          phone_number_id: { not: null }
        },
        orderBy: { id: "desc" }
      });
      if (!setup) {
        return res.status(400).json({
          success: false,
          message: "WhatsApp setup not completed. Please complete WhatsApp Business setup with both WABA ID and Phone Number ID.",
          code: "WHATSAPP_SETUP_REQUIRED",
        });
      }

      const wabaId = String(setup.waba_id);
      const phoneNumberId = String(setup.phone_number_id);
      const accessToken = env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) {
        return res.status(500).json({ success: false, message: "Interakt access token not configured" });
      }

      // Ensure phone number is in +<country><number> format
      let to = body.to.trim();
      if (!to.startsWith("+")) {
        if (to.startsWith("91")) to = "+" + to; else to = "+91" + to; // heuristic
      }

      const messagePayload: any = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: body.templateName,
          language: { code: body.languageCode.split("_")[0] },
        },
      };

      if (Array.isArray(body.components) && body.components.length > 0) {
        messagePayload.template.components = body.components;
      } else if (body.cta) {
        messagePayload.template.components = [
          {
            type: "button",
            sub_type: "url",
            index: String(body.cta.index ?? 0),
            parameters: [
              {
                type: "payload",
                payload: body.cta.payload,
              },
            ],
          },
        ];
      }

      console.log("Send CTA - Request:", {
        url: `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`,
        wabaId,
        phoneNumberId,
        payload: messagePayload,
      });

      const interaktResp = await fetch(
        `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            "x-access-token": accessToken,
            "x-waba-id": wabaId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messagePayload),
        }
      );

      const text = await interaktResp.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (!interaktResp.ok) {
        return res.status(interaktResp.status).json({
          success: false,
          message: `Interakt API error: ${interaktResp.status} ${interaktResp.statusText}`,
          details: data,
        });
      }

      return res.json({ success: true, data });
    } finally {
      // prisma is shared; no disconnect here
    }
  } catch (error: any) {
    console.error("Error sending CTA template:", error);
    if (error.name === "ZodError") {
      return res.status(400).json({ success: false, message: "Invalid request data", errors: error.errors });
    }
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
});

/**
 * @swagger
 * /api/send-template/campaigns:
 *   get:
 *     tags:
 *       - Send Template
 *     summary: Get user's campaigns
 *     description: Retrieves all campaigns for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by campaign status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of campaigns to return
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *     responses:
 *       200:
 *         description: Campaigns retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
// GET /api/send-template/campaigns - Get user's campaigns
router.get("/campaigns", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const querySchema = z.object({
      status: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      page: z.coerce.number().int().min(1).default(1),
    });

    const query = querySchema.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    const client = await pool.connect();
    try {
      let whereClause = 'WHERE user_id = $1';
      let params = [userId];
      let paramIndex = 1;

      if (query.status && query.status !== 'all') {
        paramIndex++;
        whereClause += ` AND status = $${paramIndex}`;
        params.push(query.status.toUpperCase());
      }

      // Get campaigns with pagination
      const campaignsResult = await client.query(
        `SELECT * FROM campaigns ${whereClause} 
         ORDER BY created_at DESC 
         LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
        [...params, query.limit, offset]
      );

      // Get total count
      const countResult = await client.query(
        `SELECT COUNT(*) as total FROM campaigns ${whereClause}`,
        params
      );

      const total = parseInt(countResult.rows[0].total);

      // Transform campaigns to match frontend format
      const campaigns = campaignsResult.rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.trigger_type === 'IMMEDIATE' ? 'IMMEDIATE' : 'SCHEDULED',
        status: row.status,
        receiverCount: row.audience_size,
        messageCount: 1, // Each campaign sends one message type
        createdOn: new Date(row.created_at).toLocaleDateString('en-US', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }),
        scheduledFor: row.scheduled_at 
          ? new Date(row.scheduled_at).toLocaleDateString('en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : row.trigger_type === 'IMMEDIATE' ? 'Immediate' : 'Not scheduled',
        processedOn: row.processed_at 
          ? new Date(row.processed_at).toLocaleDateString('en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : undefined,
        completedOn: row.completed_at
          ? new Date(row.completed_at).toLocaleDateString('en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : undefined,
        deliveryRate: 0, // Will be calculated from message logs
        openRate: 0, // Will be calculated from message logs
      }));

      // Calculate delivery and open rates for completed campaigns
      for (const campaign of campaigns) {
        if (campaign.status === 'COMPLETED' || campaign.status === 'PARTIALLY_COMPLETED') {
          const statsResult = await client.query(
            `SELECT 
               COUNT(*) as total,
               COUNT(CASE WHEN status = 'SENT' OR status = 'DELIVERED' OR status = 'READ' THEN 1 END) as delivered,
               COUNT(CASE WHEN status = 'READ' THEN 1 END) as read
             FROM message_logs 
             WHERE campaign_id = $1`,
            [campaign.id]
          );

          const stats = statsResult.rows[0];
          if (stats.total > 0) {
            campaign.deliveryRate = Math.round((stats.delivered / stats.total) * 100);
            campaign.openRate = Math.round((stats.read / stats.total) * 100);
          }
        }
      }

      res.json({
        success: true,
        data: campaigns,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: total,
          pages: Math.ceil(total / query.limit)
        }
      });

    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('Error fetching campaigns:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching campaigns',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/send-template/messages:
 *   get:
 *     tags:
 *       - Send Template
 *     summary: Get message logs
 *     description: Retrieves message logs for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by phone number, message ID, or template name
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of messages to return
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number for pagination
 *     responses:
 *       200:
 *         description: Message logs retrieved successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal server error
 */
// GET /api/send-template/messages - Get message logs
router.get("/messages", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const querySchema = z.object({
      search: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      page: z.coerce.number().int().min(1).default(1),
    });

    const query = querySchema.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    const client = await pool.connect();
    try {
      let whereClause = 'WHERE user_id = $1';
      let params = [userId];
      let paramIndex = 1;

      if (query.search) {
        paramIndex++;
        whereClause += ` AND (to_number ILIKE $${paramIndex} OR message_id ILIKE $${paramIndex} OR template_name ILIKE $${paramIndex})`;
        params.push(`%${query.search}%`);
      }

      // Get message logs with pagination
      const messagesResult = await client.query(
        `SELECT * FROM message_logs ${whereClause} 
         ORDER BY created_at DESC 
         LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
        [...params, query.limit, offset]
      );

      // Get total count
      const countResult = await client.query(
        `SELECT COUNT(*) as total FROM message_logs ${whereClause}`,
        params
      );

      const total = parseInt(countResult.rows[0].total);

      // Transform messages to match frontend format
      const messages = messagesResult.rows.map(row => ({
        id: row.id,
        created_at: row.created_at,
        to_number: row.to_number,
        message_type: `Template: ${row.template_name}`,
        message_id: row.message_id,
        status: row.status,
        campaign_id: row.campaign_id,
        template_name: row.template_name,
        language_code: row.language_code,
        sent_at: row.sent_at,
        delivered_at: row.delivered_at,
        read_at: row.read_at,
        failed_at: row.failed_at,
        error_message: row.error_message
      }));

      res.json({
        success: true,
        data: messages,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: total,
          pages: Math.ceil(total / query.limit)
        }
      });

    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('Error fetching message logs:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching message logs',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/send-template/campaigns/{id}/status:
 *   get:
 *     tags:
 *       - Send Template
 *     summary: Get campaign status
 *     description: Retrieves detailed status and statistics for a specific campaign
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Campaign ID
 *     responses:
 *       200:
 *         description: Campaign status retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Campaign not found
 *       500:
 *         description: Internal server error
 */
// GET /api/send-template/campaigns/:id/status - Get campaign status
router.get("/campaigns/:id/status", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { id } = z.object({ id: z.string() }).parse(req.params);

    const client = await pool.connect();
    try {
      // Get campaign details
      const campaignResult = await client.query(
        'SELECT * FROM campaigns WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      if (campaignResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }

      const campaign = campaignResult.rows[0];

      // Get message statistics
      const statsResult = await client.query(
        `SELECT 
           COUNT(*) as total,
           COUNT(CASE WHEN status = 'SENT' THEN 1 END) as sent,
           COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) as delivered,
           COUNT(CASE WHEN status = 'READ' THEN 1 END) as read,
           COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed,
           COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending
         FROM message_logs 
         WHERE campaign_id = $1`,
        [id]
      );

      const stats = statsResult.rows[0];
      const total = parseInt(stats.total);
      const sent = parseInt(stats.sent);
      const delivered = parseInt(stats.delivered);
      const read = parseInt(stats.read);
      const failed = parseInt(stats.failed);
      const pending = parseInt(stats.pending);

      // Calculate progress percentage
      let progress = 0;
      if (total > 0) {
        if (campaign.status === 'COMPLETED') {
          progress = 100;
        } else if (campaign.status === 'FAILED') {
          progress = 0;
        } else {
          progress = Math.round(((sent + delivered + read + failed) / total) * 100);
        }
      }

      res.json({
        success: true,
        data: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          totalCount: total,
          sentCount: sent,
          deliveredCount: delivered,
          readCount: read,
          failedCount: failed,
          pendingCount: pending,
          progress: progress,
          createdAt: campaign.created_at,
          scheduledAt: campaign.scheduled_at,
          processedAt: campaign.processed_at,
          completedAt: campaign.completed_at
        }
      });

    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('Error fetching campaign status:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid campaign ID',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching campaign status',
      error: error.message
    });
  }
});

export default router;
