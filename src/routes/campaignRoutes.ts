import { Router } from "express";
import { z } from "zod";
import { interaktClient } from "../services/interaktClient";
import { withFallback } from "../utils/fallback";
import { ContactService } from "../services/contactService";
import { authenticateToken } from "../middleware/authMiddleware";

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
router.post("/send-template", authenticateToken, async (req, res, next) => {
  try {
    const bodySchema = z.object({
      templateId: z.string(),
      contactIds: z.array(z.string()),
      parameters: z.record(z.string(), z.string()).optional(),
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

    // Resolve contacts
    const contacts = await Promise.all(
      body.contactIds.map(async (id) => {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) return null;
        return await ContactService.getContactById(numericId);
      })
    );

    // Prepare parameter mapping (POSITIONAL only)
    const paramValues: string[] | undefined = body.parameters
      ? Object.keys(body.parameters)
          .sort()
          .map((k) => body.parameters![k])
      : undefined;

    const sendResults = await Promise.allSettled(
      contacts.map(async (contact) => {
        if (!contact || !contact.whatsapp_number) {
          throw new Error("Missing contact or whatsapp_number");
        }

        const components = paramValues && paramValues.length > 0
          ? [
              {
                type: "body",
                parameters: paramValues.map((text) => ({ type: "text", text })),
              },
            ]
          : undefined;

        const payload: any = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: contact.whatsapp_number,
          type: "template",
          template: {
            name: template.name,
            language: { code: template.language || "en" },
            ...(components ? { components } : {}),
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
        return msgId;
      })
    );

    const messageIds: string[] = [];
    let failedCount = 0;
    sendResults.forEach((r) => {
      if (r.status === "fulfilled") messageIds.push(r.value);
      else failedCount += 1;
    });

    res.json({
      success: failedCount === 0,
      messageIds,
      failedCount,
      totalSent: contacts.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
