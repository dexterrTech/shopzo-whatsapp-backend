import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/authMiddleware";
import { pool } from "../config/database";
import { env } from "../config/env";

const router = Router();

// POST /api/send-flow - Send Flow message to a single recipient
router.post("/", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const sendFlowSchema = z.object({
      to: z.string().min(5),
      template_name: z.string().min(1),
      language_code: z.string().min(2).max(5),
      flow_token: z.string().optional(),
      flow_action_data: z.any().optional(),
    });

    const body = sendFlowSchema.parse(req.body);

    // Get user's WABA ID and phone number ID from whatsapp_setups
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
      
      console.log('Using WABA ID:', wabaId);
      console.log('Using Phone Number ID:', phoneNumberId);
      console.log('Template name:', body.template_name);
      
      if (!accessToken) {
        return res.status(500).json({
          success: false,
          message: 'Server configuration error: Interakt access token not configured'
        });
      }

      // Format phone number (remove + if present)
      const formattedPhone = body.to.startsWith('+') ? body.to.substring(1) : body.to;

      // Build Flow message payload (matching working Postman request)
      const messagePayload = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
          name: body.template_name,
          language: {
            code: body.language_code
          },
          components: [
            {
              type: "button",
              sub_type: "flow",
              index: "0",
              parameters: [
                {
                  type: "action",
                  action: {
                    flow_token: body.flow_token || "unused",
                    ...(body.flow_action_data && { flow_action_data: body.flow_action_data })
                  }
                }
              ]
            }
          ]
        }
      };

      console.log('Flow message payload:', JSON.stringify(messagePayload, null, 2));

      // Call Interakt API to send Flow message (use phone number ID in URL, not WABA ID)
      const apiUrl = `https://amped-express.interakt.ai/api/v17.0/${phoneNumberId}/messages`;
      console.log('Calling Interakt API URL:', apiUrl);
      console.log('Headers:', {
        'x-access-token': accessToken ? `${accessToken.substring(0, 10)}...` : 'NOT_SET',
        'x-waba-id': wabaId,
        'Content-Type': 'application/json'
      });

      const interaktResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'x-access-token': accessToken,
          'x-waba-id': wabaId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
      });

      // Read response as text first, then try to parse as JSON
      const responseText = await interaktResponse.text();
      let interaktData;
      
      try {
        interaktData = JSON.parse(responseText);
      } catch (parseError) {
        // Handle non-JSON responses (like "Invalid request")
        console.error('Interakt API error (non-JSON):', responseText);
        return res.status(interaktResponse.status).json({
          success: false,
          message: "Failed to send Flow message",
          error: responseText,
          status: interaktResponse.status
        });
      }

      if (!interaktResponse.ok) {
        console.error('Interakt API error:', interaktData);
        return res.status(interaktResponse.status).json({
          success: false,
          message: "Failed to send Flow message",
          error: interaktData,
          status: interaktResponse.status
        });
      }

      console.log('Flow message sent successfully:', interaktData);

      res.json({
        success: true,
        message: "Flow message sent successfully",
        data: interaktData
      });

    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('Error sending Flow message:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid request data',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while sending Flow message',
      error: error.message
    });
  }
});

export { router as sendFlowRoutes };
