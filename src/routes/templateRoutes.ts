import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/authMiddleware";
import { pool } from "../config/database";
import { env } from "../config/env";

const router = Router();

// Types for template responses
export interface TemplateComponent {
  type: string;
  text?: string;
  format?: string;
  example?: any;
  buttons?: any[];
  cards?: any[];
  limited_time_offer?: any;
}

export interface Template {
  id: string;
  name: string;
  parameter_format: string;
  components: TemplateComponent[];
  language: string;
  status: string;
  category: string;
  sub_category?: string;
  previous_category?: string;
  correct_category?: string;
}

export interface TemplateResponse {
  data: Template[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
  };
}

export interface TemplateFetchParams {
  limit?: number;
  after?: string;
  before?: string;
}

/**
 * @swagger
 * /api/templates:
 *   get:
 *     tags:
 *       - Templates
 *     summary: Get user's WhatsApp message templates
 *     description: Fetches message templates from Interakt using the logged-in user's WABA ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of templates to return (default: 25)
 *         example: 25
 *       - in: query
 *         name: after
 *         schema:
 *           type: string
 *         description: Cursor for pagination (next page)
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *         description: Cursor for pagination (previous page)
 *     responses:
 *       200:
 *         description: Templates retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Template'
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
 *       400:
 *         description: Bad request - missing WABA ID
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - access denied to WABA
 *       404:
 *         description: WABA not found
 *       500:
 *         description: Internal server error
 */
// GET /api/templates - Get user's templates from Interakt
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    // Parse query parameters
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      after: z.string().optional(),
      before: z.string().optional(),
    });

    const query = querySchema.parse(req.query);

    // Get user's WABA ID from whatsapp_setups table
    const setupResult = await pool.query(
      'SELECT waba_id FROM whatsapp_setups WHERE user_id = $1 AND waba_id IS NOT NULL',
      [userId]
    );

    if (setupResult.rows.length === 0 || !setupResult.rows[0].waba_id) {
      return res.status(400).json({
        success: false,
        message: 'WhatsApp setup not completed. Please complete WhatsApp Business setup first.',
        code: 'WHATSAPP_SETUP_REQUIRED'
      });
    }

    const wabaId = setupResult.rows[0].waba_id;
    const accessToken = env.INTERAKT_ACCESS_TOKEN;

    if (!accessToken) {
      return res.status(500).json({
        success: false,
        message: 'Server configuration error: Interakt access token not configured'
      });
    }

    // Build the Interakt API URL
    const baseURL = 'https://amped-express.interakt.ai/api/v17.0';
    const url = `${baseURL}/${wabaId}/message_templates`;

    // Prepare request parameters
    const params = new URLSearchParams();
    if (query.limit) params.append('limit', query.limit.toString());
    if (query.after) params.append('after', query.after);
    if (query.before) params.append('before', query.before);

    const fullUrl = params.toString() ? `${url}?${params.toString()}` : url;

    // Make request to Interakt API
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'x-access-token': accessToken,
        'x-waba-id': wabaId,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to fetch templates from Interakt';
      
      if (response.status === 401) {
        errorMessage = 'Unauthorized: Invalid access token or WABA ID';
      } else if (response.status === 403) {
        errorMessage = 'Forbidden: Access denied to this WABA';
      } else if (response.status === 404) {
        errorMessage = 'WABA not found or templates endpoint not available';
      } else if (response.status >= 500) {
        errorMessage = 'Interakt server error. Please try again later.';
      }

      return res.status(response.status).json({
        success: false,
        message: errorMessage,
        details: errorText,
        status: response.status
      });
    }

    const data: TemplateResponse = await response.json();

    // Transform the response to match our expected format
    const transformedData = {
      success: true,
      data: data.data || [],
      paging: data.paging || {},
      waba_id: wabaId
    };

    res.json(transformedData);

  } catch (error: any) {
    console.error('Error fetching templates:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching templates',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/templates/{id}:
 *   get:
 *     tags:
 *       - Templates
 *     summary: Get template by ID
 *     description: Fetches a specific template by ID from Interakt using the user's WABA ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Template retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Template'
 *       400:
 *         description: Bad request - missing WABA ID
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       404:
 *         description: Template not found
 *       500:
 *         description: Internal server error
 */
// GET /api/templates/:id - Get specific template by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }

    const { id } = z.object({ id: z.string() }).parse(req.params);

    // Get user's WABA ID from whatsapp_setups table
    const setupResult = await pool.query(
      'SELECT waba_id FROM whatsapp_setups WHERE user_id = $1 AND waba_id IS NOT NULL',
      [userId]
    );

    if (setupResult.rows.length === 0 || !setupResult.rows[0].waba_id) {
      return res.status(400).json({
        success: false,
        message: 'WhatsApp setup not completed. Please complete WhatsApp Business setup first.',
        code: 'WHATSAPP_SETUP_REQUIRED'
      });
    }

    const wabaId = setupResult.rows[0].waba_id;
    const accessToken = env.INTERAKT_ACCESS_TOKEN;

    if (!accessToken) {
      return res.status(500).json({
        success: false,
        message: 'Server configuration error: Interakt access token not configured'
      });
    }

    // Build the Interakt API URL for specific template
    const baseURL = 'https://amped-express.interakt.ai/api/v17.0';
    const url = `${baseURL}/${wabaId}/message_templates/id/${id}`;

    // Make request to Interakt API
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-access-token': accessToken,
        'x-waba-id': wabaId,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to fetch template from Interakt';
      
      if (response.status === 401) {
        errorMessage = 'Unauthorized: Invalid access token or WABA ID';
      } else if (response.status === 403) {
        errorMessage = 'Forbidden: Access denied to this WABA';
      } else if (response.status === 404) {
        errorMessage = 'Template not found';
      } else if (response.status >= 500) {
        errorMessage = 'Interakt server error. Please try again later.';
      }

      return res.status(response.status).json({
        success: false,
        message: errorMessage,
        details: errorText,
        status: response.status
      });
    }

    const template: Template = await response.json();

    res.json({
      success: true,
      data: template,
      waba_id: wabaId
    });

  } catch (error: any) {
    console.error('Error fetching template by ID:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid template ID',
        errors: error.errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching template',
      error: error.message
    });
  }
});

// Helper function to sanitize template name for Interakt API
function sanitizeTemplateName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_');
}

/**
 * @swagger
 * /api/templates:
 *   post:
 *     tags:
 *       - Templates
 *     summary: Create a new WhatsApp message template
 *     description: Creates a new WhatsApp message template in Interakt using the user's WABA ID
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
 *               - language
 *               - category
 *               - components
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 512
 *                 description: The name of the template (e.g., "Welcome Message", "Order Confirmation")
 *               language:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 5
 *                 description: The language code (e.g., "en", "es", "fr")
 *               category:
 *                 type: string
 *                 enum: ["MARKETING", "UTILITY", "AUTHENTICATION"]
 *                 description: The category of the template (e.g., "MARKETING", "UTILITY", "AUTHENTICATION")
 *               components:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - type
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: ["HEADER", "BODY", "FOOTER", "BUTTONS"]
 *                       description: The type of component (e.g., "HEADER", "BODY", "FOOTER", "BUTTONS")
 *                     text:
 *                       type: string
 *                       description: The text content for BODY and FOOTER components.
 *                     format:
 *                       type: string
 *                       enum: ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]
 *                       description: The format for HEADER and BODY components.
 *                     example:
 *                       type: object
 *                       description: The example data for BUTTONS component.
 *                 minItems: 1
 *                 description: An array of components that make up the template.
 *               auto_category:
 *                 type: boolean
 *                 default: false
 *                 description: Whether to automatically categorize the template.
 *     responses:
 *       201:
 *         description: Template created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Template'
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request - missing WABA ID or invalid template data
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - access denied to WABA
 *       404:
 *         description: WABA not found
 *       500:
 *         description: Internal server error
 */
// POST /api/templates - Create new template
router.post("/", authenticateToken, async (req, res) => {
  try {
    console.log('Template creation request received:', {
      headers: req.headers,
      body: req.body,
      user: (req as any).user
    });
    
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: true, message: "User not authenticated" });
    }
    
    console.log('User authenticated, userId:', userId);
    
    const bodySchema = z.object({
      name: z.string().min(1).max(512),
      language: z.string().min(2).max(5),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
      components: z.array(z.object({
        type: z.enum(["HEADER", "BODY", "FOOTER", "BUTTONS"]),
        text: z.string().optional(),
        format: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]).optional(),
        example: z.any().optional(),
      })).min(1),
      auto_category: z.boolean().default(false),
    });
    
    const body = bodySchema.parse(req.body);
    console.log('Request body validated:', body);
    
    // Get user's WABA ID from database
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT waba_id FROM whatsapp_setups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      
      if (result.rows.length === 0) {
        return res.status(400).json({ 
          error: true, 
          message: "WhatsApp setup not found. Please complete WhatsApp setup first." 
        });
      }
      
      const wabaId = result.rows[0].waba_id;
      console.log('Found WABA ID:', wabaId);
      
      // Get access token from environment
      const accessToken = process.env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) {
        return res.status(500).json({ error: true, message: "Interakt access token not configured" });
      }
      
      // Sanitize the template name for Interakt API
      const sanitizedName = sanitizeTemplateName(body.name);
      console.log('Original name:', body.name, 'Sanitized name:', sanitizedName);
      
      // Prepare template payload for Interakt
      const templatePayload = {
        name: sanitizedName,
        language: body.language,
        category: body.category,
        components: body.components.map(comp => {
          if (comp.type === "HEADER" && comp.format) {
            return {
              type: comp.type,
              format: comp.format,
              text: comp.text || "",
              example: comp.example
            };
          } else if (comp.type === "BODY") {
            return {
              type: comp.type,
              text: comp.text || ""
            };
          } else if (comp.type === "FOOTER") {
            return {
              type: comp.type,
              text: comp.text || ""
            };
          } else if (comp.type === "BUTTONS") {
            return {
              type: comp.type,
              buttons: comp.example || []
            };
          }
          return comp;
        })
      };
      
      console.log('Sending request to Interakt:', {
        url: `https://amped-express.interakt.ai/api/v17.0/${wabaId}/message_templates`,
        payload: templatePayload,
        headers: { 
          'x-access-token': accessToken ? '***' : 'NOT_SET', 
          'x-waba-id': wabaId 
        }
      });
      
      // Call Interakt API to create template
      const interaktResponse = await fetch(
        `https://amped-express.interakt.ai/api/v17.0/${wabaId}/message_templates`,
        {
          method: 'POST',
          headers: {
            'x-access-token': accessToken,
            'x-waba-id': wabaId,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(templatePayload)
        }
      );
      
      const interaktData = await interaktResponse.json();
      console.log('Interakt API response:', {
        status: interaktResponse.status,
        data: interaktData
      });
      
      if (!interaktResponse.ok) {
        return res.status(interaktResponse.status).json({
          error: true,
          message: `Interakt API error: ${interaktResponse.status} ${interaktResponse.statusText}`,
          details: interaktData
        });
      }
      
      res.json({
        success: true,
        data: interaktData,
        message: "Template created successfully"
      });
      
    } finally {
      client.release();
    }
    
  } catch (error: any) {
    console.error('Template creation error:', error);
    res.status(500).json({ 
      error: true, 
      message: error.message || "Failed to create template" 
    });
  }
});

/**
 * @swagger
 * /api/templates/send:
 *   post:
 *     tags:
 *       - Templates
 *     summary: Send a template message
 *     description: Sends a template message to a WhatsApp number using Interakt
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
 *               - template_name
 *               - language_code
 *             properties:
 *               to:
 *                 type: string
 *                 format: phone
 *                 description: Phone number to send message to (e.g., "+1234567890")
 *               template_name:
 *                 type: string
 *                 description: Name of the template to send
 *               language_code:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 5
 *                 description: Language code for the template (e.g., "en", "es")
 *               parameters:
 *                 type: array
 *                 description: Optional parameters for the template
 *     responses:
 *       200:
 *         description: Template message sent successfully
 *       400:
 *         description: Bad request - missing WABA ID or invalid data
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error
 */
// POST /api/templates/send - Send template message
router.post("/send", authenticateToken, async (req, res) => {
  try {
    console.log('Template send request received:', {
      headers: req.headers,
      body: req.body,
      user: (req as any).user
    });
    
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: true, message: "User not authenticated" });
    }
    
    console.log('User authenticated, userId:', userId);
    
    const bodySchema = z.object({
      to: z.string().min(1),
      template_name: z.string().min(1),
      language_code: z.string().min(2).max(5),
      parameters: z.array(z.any()).optional(),
    });
    
    const body = bodySchema.parse(req.body);
    console.log('Request body validated:', body);
    
    // Get user's WABA ID from database
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT waba_id FROM whatsapp_setups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      
      if (result.rows.length === 0) {
        return res.status(400).json({ 
          error: true, 
          message: "WhatsApp setup not found. Please complete WhatsApp setup first." 
        });
      }
      
      const wabaId = result.rows[0].waba_id;
      console.log('Found WABA ID:', wabaId);
      
      // Get access token from environment
      const accessToken = process.env.INTERAKT_ACCESS_TOKEN;
      if (!accessToken) {
        return res.status(500).json({ error: true, message: "Interakt access token not configured" });
      }
      
      // Sanitize template name for Interakt API
      const sanitizedTemplateName = sanitizeTemplateName(body.template_name);
      console.log('Original template name:', body.template_name, 'Sanitized name:', sanitizedTemplateName);
      
      // Prepare message payload for Interakt
      const messagePayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: body.to,
        type: "template",
        template: {
          name: sanitizedTemplateName,
          language: {
            code: body.language_code
          }
        }
      };
      
      if (body.parameters && body.parameters.length > 0) {
        (messagePayload.template as any).components = body.parameters;
      }
      
      console.log('Sending request to Interakt:', {
        url: `https://amped-express.interakt.ai/api/v17.0/${wabaId}/messages`,
        payload: messagePayload,
        headers: { 
          'x-access-token': accessToken ? '***' : 'NOT_SET', 
          'x-waba-id': wabaId 
        }
      });
      
      // Call Interakt API to send template message
      const interaktResponse = await fetch(
        `https://amped-express.interakt.ai/api/v17.0/${wabaId}/messages`,
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
      
      const interaktData = await interaktResponse.json();
      console.log('Interakt API response:', {
        status: interaktResponse.status,
        data: interaktData
      });
      
      if (!interaktResponse.ok) {
        return res.status(interaktResponse.status).json({
          error: true,
          message: `Interakt API error: ${interaktResponse.status} ${interaktResponse.statusText}`,
          details: interaktData
        });
      }
      
      res.json({
        success: true,
        data: interaktData,
        message: "Template message sent successfully"
      });
      
    } finally {
      client.release();
    }
    
  } catch (error: any) {
    console.error('Template send error:', error);
    res.status(500).json({ 
      error: true, 
      message: error.message || "Failed to send template message" 
    });
  }
});

/**
 * @swagger
 * /api/templates/{id}:
 *   delete:
 *     tags:
 *       - Templates
 *     summary: Delete a template by ID
 *     description: Deletes a specific template by ID from Interakt using the user's WABA ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Template deleted successfully
 *       400:
 *         description: Bad request - missing WABA ID
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       404:
 *         description: Template not found
 *       500:
 *         description: Internal server error
 */
// DELETE /api/templates/:id - Delete specific template by ID
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: true, message: "User not authenticated" });
    }

    const { id } = z.object({ id: z.string() }).parse(req.params);

    // Get user's WABA ID from database
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT waba_id FROM whatsapp_setups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      
      if (result.rows.length === 0) {
        return res.status(400).json({ 
          error: true, 
          message: "WhatsApp setup not found. Please complete WhatsApp setup first." 
        });
      }
      
      const wabaId = result.rows[0].waba_id;
      const accessToken = process.env.INTERAKT_ACCESS_TOKEN;

      if (!accessToken) {
        return res.status(500).json({ error: true, message: "Interakt access token not configured" });
      }

      // Build the Interakt API URL for template deletion
      const url = `https://amped-express.interakt.ai/api/v17.0/${wabaId}/message_templates/id/${id}`;

      // Make request to Interakt API
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'x-access-token': accessToken,
          'x-waba-id': wabaId,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = 'Failed to delete template from Interakt';
        
        if (response.status === 401) {
          errorMessage = 'Unauthorized: Invalid access token or WABA ID';
        } else if (response.status === 403) {
          errorMessage = 'Forbidden: Access denied to this WABA';
        } else if (response.status === 404) {
          errorMessage = 'Template not found';
        } else if (response.status >= 500) {
          errorMessage = 'Interakt server error. Please try again later.';
        }

        return res.status(response.status).json({
          error: true,
          message: errorMessage,
          details: errorText,
          status: response.status
        });
      }

      const deletedTemplate = await response.json();

      res.json({
        success: true,
        data: deletedTemplate,
        message: 'Template deleted successfully'
      });

    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('Error deleting template:', error);
    
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: true,
        message: 'Invalid template ID',
        errors: error.errors
      });
    }

    res.status(500).json({
      error: true,
      message: 'Internal server error while deleting template',
      error_message: error.message
    });
  }
});

export default router;
