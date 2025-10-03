import { Router } from "express";
import { z } from "zod";
import { interaktClient } from "../services/interaktClient";
import { withFallback } from "../utils/fallback";
import { ContactService } from "../services/contactService";
import { authenticateToken } from "../middleware/authMiddleware";
import { upsertBillingLog, holdWalletInSuspenseForBilling } from "../services/billingService";
import { pool } from "../config/database";

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Campaigns
 *     description: Campaign management and bulk messaging
 */

/**
 * @openapi
 * /api/campaigns:
 *   post:
 *     tags:
 *       - Campaigns
 *     summary: Create Campaign
 *     description: Creates a new campaign with template or regular message for bulk sending
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
 *             properties:
 *               name:
 *                 type: string
 *                 description: Campaign name
 *               trigger:
 *                 type: string
 *                 enum: [IMMEDIATE, SCHEDULED]
 *                 description: When to trigger the campaign
 *               audienceType:
 *                 type: string
 *                 enum: [ALL, SEGMENTED, QUICK]
 *                 description: Type of audience selection
 *               messageType:
 *                 type: string
 *                 enum: [TEMPLATE, REGULAR, BOT]
 *                 description: Type of message to send
 *               templateId:
 *                 type: string
 *                 description: Template ID (required if messageType is TEMPLATE)
 *               message:
 *                 type: string
 *                 description: Custom message text (required if messageType is REGULAR)
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *                 description: Scheduled date/time (required if trigger is SCHEDULED)
 *     responses:
 *       201:
 *         description: Campaign created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 trigger:
 *                   type: string
 *                 audienceType:
 *                   type: string
 *                 messageType:
 *                   type: string
 *                 audienceSize:
 *                   type: integer
 *                 status:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 */
// POST /api/campaigns
router.post("/", authenticateToken, async (req, res, next) => {
  try {
    const bodySchema = z.object({
      name: z.string().min(1),
      trigger: z.enum(["IMMEDIATE", "SCHEDULED"]),
      audienceType: z.enum(["ALL", "SEGMENTED", "QUICK"]),
      messageType: z.enum(["TEMPLATE", "REGULAR", "BOT"]),
      templateId: z.string().optional(),
      message: z.string().optional(),
      scheduledAt: z.string().optional(),
    });

    const body = bodySchema.parse(req.body);
    
    // For now, just return a mock campaign
    // In a real implementation, you'd save this to your database
    const campaign = {
      id: "campaign-" + Math.random().toString(36).slice(2, 8),
      ...body,
      audienceSize: 402, // This would be calculated from your contacts
      status: "DRAFT" as const,
      createdAt: new Date().toISOString(),
    };

    res.status(201).json(campaign);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/campaigns/export:
 *   get:
 *     tags:
 *       - Campaigns
 *     summary: Export campaigns as CSV
 *     description: Download campaigns list as CSV (mock/demo as campaigns are not persisted yet)
 *     responses:
 *       200:
 *         description: CSV file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get("/export", authenticateToken, async (req, res, next) => {
  try {
    const headers = ['id','name','trigger','audienceType','messageType','audienceSize','status','createdAt'];
    const sample = [{
      id: 'campaign-sample',
      name: 'Sample Campaign',
      trigger: 'IMMEDIATE',
      audienceType: 'ALL',
      messageType: 'TEMPLATE',
      audienceSize: 0,
      status: 'DRAFT',
      createdAt: new Date().toISOString()
    }];
    const rows = sample.map((c: any) => headers.map((h) => {
      const v = c[h];
      const s = v === null || v === undefined ? '' : String(v);
      const needsQuotes = s.includes(',') || s.includes('\n') || s.includes('"');
      const escaped = s.replace(/"/g, '""');
      return needsQuotes ? `"${escaped}"` : escaped;
    }).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="campaigns.csv"');
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/campaigns/send-template:
 *   post:
 *     tags:
 *       - Campaigns
 *     summary: Send Template to Multiple Contacts
 *     description: Sends a template message to multiple contacts using Interakt API. This is the bulk sending functionality for campaigns.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - templateId
 *               - contactIds
 *             properties:
 *               templateId:
 *                 type: string
 *                 description: Template ID to send
 *               contactIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of contact IDs to send the template to
 *               parameters:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Template parameters (optional)
 *     responses:
 *       200:
 *         description: Template sent successfully to contacts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messageIds:
 *                   type: array
 *                   items:
 *                     type: string
 *                 failedCount:
 *                   type: integer
 *                 totalSent:
 *                   type: integer
 *                 fallback:
 *                   type: boolean
 *                   description: Indicates if fallback data was used
 */
// POST /api/campaigns/send-template
// Global auth gate already applied in server.ts; avoid double auth here
router.post("/send-template", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const mappingSchema = z.record(z.string(), z.object({
      field: z.string(),
      fallback: z.string().optional().default("")
    })).optional();
    const bodySchema = z.object({
      templateId: z.string(),
      // Either contactIds or phoneNumbers can be provided
      contactIds: z.array(z.string()).optional(),
      phoneNumbers: z.array(z.string()).optional(),
      // Flat parameters map (applies same values to all recipients)
      parameters: z.record(z.string(), z.string()).optional(),
      // Variable mappings to resolve per contact (when using contactIds)
      variableMapping: mappingSchema,
      // Location parameters for location templates
      locationParameters: z.object({
        longitude: z.number(),
        latitude: z.number(),
        name: z.string(),
        address: z.string(),
      }).optional(),
      // Header media id for IMAGE header templates
      headerImageId: z.string().optional(),
      // Limited time offer expiration in ms since epoch
      limitedTimeOfferExpirationMs: z.number().optional(),
      // Coupon code for COPY_CODE button
      couponCode: z.string().optional(),
      // URL button dynamic text parameter and optional explicit index override
      urlButtonTextParam: z.string().optional(),
      urlButtonIndex: z.number().optional(),
    }).refine((b) => (b.contactIds && b.contactIds.length) || (b.phoneNumbers && b.phoneNumbers.length), {
      message: 'Provide at least one of contactIds or phoneNumbers'
    });

    const body = bodySchema.parse(req.body);

    // Fetch template details (fallback will provide mock if credentials are missing)
    const template = await withFallback({
      feature: "getTemplateForBulkSend",
      attempt: () => interaktClient.getTemplateById(body.templateId),
      fallback: async () => ({
        id: body.templateId,
        name: "mock_template",
        language: "en",
        parameter_format: "POSITIONAL",
        components: [
          { type: "BODY", text: "Hello {{1}}" }
        ],
        status: "APPROVED",
        category: "UTILITY",
        fallback: true,
      }),
    });

    // Prepare static parameter mapping (POSITIONAL only) if provided
    const staticParamValues: string[] | undefined = body.parameters
      ? Object.keys(body.parameters)
          .sort()
          .map((k) => body.parameters![k])
      : undefined;

    // Helper: resolve per-recipient values from variableMapping and contact record
    async function resolveParamsForContact(contactId?: string): Promise<string[] | undefined> {
      // If variableMapping is not provided, fall back to staticParamValues
      if (!body.variableMapping) return staticParamValues;
      if (!contactId) return staticParamValues;
      try {
        const idNum = Number(contactId);
        const contact = await ContactService.getContactById(idNum, userId);
        const byIndex: Array<string> = [];
        const mappingEntries = Object.entries(body.variableMapping).sort(([a],[b]) => Number(a) - Number(b));
        for (const [k, cfg] of mappingEntries) {
          const idx = Number(k);
          const fieldName = (cfg.field || '').trim();
          let value: any = '';
          if (contact && fieldName) {
            value = (contact as any)[fieldName];
          }
          const resolved = (value === undefined || value === null || String(value).trim() === '') ? (cfg.fallback || '') : String(value);
          byIndex[idx - 1] = resolved;
        }
        // If we didn't build anything, use static fallbacks
        if (byIndex.length === 0) return staticParamValues;
        return byIndex;
      } catch {
        return staticParamValues;
      }
    }

    // Build recipient list from provided identifiers
    const recipients: Array<{ phone: string; contactId?: string }> = [];
    if (body.contactIds && body.contactIds.length) {
      for (const cid of body.contactIds) {
        // Fetch contact to get number
        try {
          const c = await ContactService.getContactById(Number(cid), userId);
          const phone = (c?.whatsapp_number || c?.phone || '').toString();
          if (phone) recipients.push({ phone, contactId: cid });
        } catch {}
      }
    } else if (body.phoneNumbers && body.phoneNumbers.length) {
      for (const p of body.phoneNumbers) recipients.push({ phone: p });
    }

    const sendResults = await Promise.allSettled(
      recipients.map(async ({ phone, contactId }) => {
        // Ensure phone number is in international format
        let formattedPhoneNumber = phone;
        if (!formattedPhoneNumber.startsWith('+')) {
          if (formattedPhoneNumber.startsWith('91')) {
            formattedPhoneNumber = '+' + formattedPhoneNumber;
          } else {
            formattedPhoneNumber = '+91' + formattedPhoneNumber;
          }
        }

        const perRecipientParams = await resolveParamsForContact(contactId);
        const components: any[] = [];
        
        // Detect header formats present in template
        const hasLocationHeader = template.components?.some((comp: any) =>
          comp.type === "HEADER" && comp.format === "LOCATION"
        );
        const hasImageHeader = template.components?.some((comp: any) =>
          comp.type === "HEADER" && comp.format === "IMAGE"
        );
        
        if (hasLocationHeader && body.locationParameters) {
          components.push({
            type: "header",
            parameters: [
              {
                type: "location",
                location: {
                  longitude: body.locationParameters.longitude,
                  latitude: body.locationParameters.latitude,
                  name: body.locationParameters.name,
                  address: body.locationParameters.address,
                }
              }
            ]
          });
        } else if (hasImageHeader && body.headerImageId) {
          components.push({
            type: "header",
            parameters: [
              {
                type: "image",
                image: { id: body.headerImageId }
              }
            ]
          });
        }
        
        // Add body parameters if available
        if (perRecipientParams && perRecipientParams.length > 0) {
          components.push({
            type: "body",
            parameters: perRecipientParams.map((text) => ({ type: "text", text })),
          });
        }

        // LIMITED_TIME_OFFER support
        const hasLimitedTimeOffer = template.components?.some((comp: any) => comp.type === "LIMITED_TIME_OFFER");
        if (hasLimitedTimeOffer && typeof body.limitedTimeOfferExpirationMs === 'number') {
          components.push({
            type: "limited_time_offer",
            parameters: [
              {
                type: "limited_time_offer",
                limited_time_offer: {
                  expiration_time_ms: body.limitedTimeOfferExpirationMs,
                },
              },
            ],
          });
        }

        // Buttons support: COPY_CODE and URL
        const buttonsDef: any[] = (template.components || []).find((c: any) => c.type === "BUTTONS")?.buttons || [];
        if (Array.isArray(buttonsDef) && buttonsDef.length) {
          // COPY_CODE button
          const copyIdx = buttonsDef.findIndex((b: any) => String(b.type).toUpperCase() === "COPY_CODE");
          if (copyIdx >= 0 && body.couponCode) {
            components.push({
              type: "button",
              sub_type: "copy_code",
              index: copyIdx,
              parameters: [
                {
                  type: "coupon_code",
                  coupon_code: body.couponCode,
                },
              ],
            });
          }

          // URL button
          const urlIdxInTpl = buttonsDef.findIndex((b: any) => String(b.type).toUpperCase() === "URL");
          const urlIndex = typeof body.urlButtonIndex === 'number' ? body.urlButtonIndex : urlIdxInTpl;
          if (urlIndex >= 0 && body.urlButtonTextParam) {
            components.push({
              type: "button",
              sub_type: "url",
              index: urlIndex,
              parameters: [
                {
                  type: "text",
                  text: body.urlButtonTextParam,
                },
              ],
            });
          }
        }

        const payload: any = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: formattedPhoneNumber,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.language || "en" },
            ...(components.length > 0 ? { components } : {}),
          },
        };

        const resp = await withFallback({
          feature: "sendTemplateToContact",
          attempt: () => interaktClient.sendMediaTemplate(payload),
          fallback: async () => ({
            messaging_product: "whatsapp",
            contacts: [{ input: payload.to, wa_id: payload.to }],
            messages: [{ id: "mock-bulk-" + Math.random().toString(36).slice(2, 10), message_status: "accepted" }],
            fallback: true,
          }),
        });

        const msgId = resp?.messages?.[0]?.id ?? "unknown";

        // Create billing log and hold funds in suspense for each message sent
        try {
          // Determine category from template metadata/name
          let category: 'utility' | 'marketing' | 'authentication' | 'service' = 'utility';
          const tplCat = String((template as any).category || '').toLowerCase();
          const tplName = String((template as any).name || '').toLowerCase();
          if (tplCat.includes('market') || tplName.includes('market') || tplName.includes('promo')) category = 'marketing';
          else if (tplCat.includes('auth') || tplName.includes('auth')) category = 'authentication';
          else if (tplCat.includes('service') || tplName.includes('service')) category = 'service';

          const ins = await upsertBillingLog({
            userId,
            conversationId: msgId,
            category,
            recipientNumber: formattedPhoneNumber,
            startTime: new Date(),
            endTime: new Date(),
            billingStatus: 'pending',
          });
          if (ins) {
            const amtRes = await pool.query('SELECT amount_paise, amount_currency FROM billing_logs WHERE id = $1', [ins.id]);
            const row = amtRes.rows[0];
            if (row) {
              await holdWalletInSuspenseForBilling({ userId, conversationId: msgId, amountPaise: row.amount_paise, currency: row.amount_currency });
            }
          }
        } catch (e) {
          console.warn('Campaign billing hold failed for message', msgId, e);
        }

        return { phoneNumber: formattedPhoneNumber, messageId: msgId };
      })
    );

    const messageIds: string[] = [];
    let failedCount = 0;
    sendResults.forEach((r) => {
      if (r.status === "fulfilled") messageIds.push(r.value.messageId);
      else failedCount += 1;
    });

    res.json({
      success: failedCount === 0,
      messageIds,
      failedCount,
      totalSent: recipients.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
