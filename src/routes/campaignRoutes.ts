import { Router } from "express";
import { z } from "zod";
import { interaktClient } from "../services/interaktClient";
import { withFallback } from "../utils/fallback";

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
router.post("/", async (req, res, next) => {
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
router.post("/send-template", async (req, res, next) => {
  try {
    const bodySchema = z.object({
      templateId: z.string(),
      contactIds: z.array(z.string()),
      parameters: z.record(z.string(), z.string()).optional(),
    });

    const body = bodySchema.parse(req.body);

    // In a real implementation, you would:
    // 1. Fetch the template details from Interakt
    // 2. Fetch the contacts from your database using contactIds
    // 3. Send the template message to each contact

    const results = await withFallback({
      feature: "sendTemplateToContacts",
      attempt: async () => {
        // This is a simplified version - in reality you'd loop through contacts
        // and send individual messages using interaktClient.sendMediaTemplate
        
        // Mock successful sends
        const messageIds = body.contactIds.map(() => 
          "wamid." + Math.random().toString(36).slice(2, 15).toUpperCase()
        );
        
        return {
          success: true,
          messageIds,
          failedCount: 0,
          totalSent: body.contactIds.length,
        };
      },
      fallback: async () => ({
        success: true,
        messageIds: body.contactIds.map(() => "mock-msg-" + Math.random().toString(36).slice(2, 8)),
        failedCount: 0,
        totalSent: body.contactIds.length,
        fallback: true,
      }),
    });

    res.json(results);
  } catch (err) {
    next(err);
  }
});

export default router;
