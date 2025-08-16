import { Router } from "express";
import { z } from "zod";
import { withFallback } from "../utils/fallback";
import { env } from "../config/env";

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Conversational Components
 *     description: WhatsApp conversational automation features including welcome messages, commands, and ice breakers
 */

/**
 * @openapi
 * /api/conversational-components/{phone_number_id}/welcome-message:
 *   post:
 *     tags:
 *       - Conversational Components
 *     summary: Welcome Message (Enable/Disable)
 *     description: Enable or disable welcome messages for a specific phone number. This is useful for customer support and account servicing interactions.
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
 *               - enable_welcome_message
 *             properties:
 *               enable_welcome_message:
 *                 type: boolean
 *                 description: Enable (true) or disable (false) welcome messages
 *                 example: true
 *     responses:
 *       200:
 *         description: Welcome message configuration updated successfully
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
// POST /api/conversational-components/:phone_number_id/welcome-message
router.post("/:phone_number_id/welcome-message", async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "configureWelcomeMessage",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/conversational_automation`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Configure welcome message API error: ${response.status} ${response.statusText}`);
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

/**
 * @openapi
 * /api/conversational-components/{phone_number_id}/automation:
 *   post:
 *     tags:
 *       - Conversational Components
 *     summary: Conversational Automation
 *     description: Configure complete conversational components including welcome messages, commands, and prompts for enhanced user interaction.
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
 *             properties:
 *               enable_welcome_message:
 *                 type: boolean
 *                 description: Enable or disable welcome messages
 *                 example: true
 *               commands:
 *                 type: array
 *                 maxItems: 30
 *                 items:
 *                   type: object
 *                   required:
 *                     - command_name
 *                     - command_description
 *                   properties:
 *                     command_name:
 *                       type: string
 *                       maxLength: 32
 *                       description: Command name (max 32 characters, no emojis)
 *                       example: "tickets"
 *                     command_description:
 *                       type: string
 *                       maxLength: 256
 *                       description: Command description (max 256 characters, no emojis)
 *                       example: "Book flight tickets"
 *                 description: List of commands (max 30 commands)
 *               prompts:
 *                 type: array
 *                 maxItems: 4
 *                 items:
 *                   type: string
 *                   maxLength: 80
 *                   description: Ice breaker prompts (max 80 characters, no emojis)
 *                 description: List of ice breaker prompts (max 4 prompts)
 *                 example: ["Book a flight", "Plan a vacation"]
 *     responses:
 *       200:
 *         description: Conversational automation configured successfully
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
// POST /api/conversational-components/:phone_number_id/automation
router.post("/:phone_number_id/automation", async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    // Validate input
    if (body.commands && body.commands.length > 30) {
      return res.status(400).json({ error: "Maximum 30 commands allowed" });
    }

    if (body.prompts && body.prompts.length > 4) {
      return res.status(400).json({ error: "Maximum 4 prompts allowed" });
    }

    if (body.commands) {
      for (const cmd of body.commands) {
        if (cmd.command_name && cmd.command_name.length > 32) {
          return res.status(400).json({ error: "Command name must be 32 characters or less" });
        }
        if (cmd.command_description && cmd.command_description.length > 256) {
          return res.status(400).json({ error: "Command description must be 256 characters or less" });
        }
      }
    }

    if (body.prompts) {
      for (const prompt of body.prompts) {
        if (prompt && prompt.length > 80) {
          return res.status(400).json({ error: "Prompt must be 80 characters or less" });
        }
      }
    }

    const data = await withFallback({
      feature: "configureConversationalAutomation",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/conversational_automation`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Configure conversational automation API error: ${response.status} ${response.statusText}`);
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

/**
 * @openapi
 * /api/conversational-components/{phone_number_id}/configuration:
 *   get:
 *     tags:
 *       - Conversational Components
 *     summary: Fetch Conversation Configuration
 *     description: Get the current configuration of conversational components including welcome messages, commands, and prompts for a specific phone number.
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *     responses:
 *       200:
 *         description: Conversation configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversational_automation:
 *                   type: object
 *                   properties:
 *                     enable_welcome_message:
 *                       type: boolean
 *                       description: Whether welcome messages are enabled
 *                     id:
 *                       type: string
 *                       description: Phone number ID
 *                     commands:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           command_name:
 *                             type: string
 *                           command_description:
 *                             type: string
 *                       description: List of configured commands
 *                     prompts:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: List of configured ice breaker prompts
 *                 id:
 *                   type: string
 *                   description: Phone number ID
 *                 fallback:
 *                   type: boolean
 */
// GET /api/conversational-components/:phone_number_id/configuration
router.get("/:phone_number_id/configuration", async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;

    const data = await withFallback({
      feature: "getConversationalAutomation",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}?fields=conversational_automation`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Get conversational automation API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        conversational_automation: {
          enable_welcome_message: true,
          id: phone_number_id,
          commands: [
            {
              command_name: "tickets",
              command_description: "Book flight tickets"
            },
            {
              command_name: "hotel",
              command_description: "Book hotel"
            }
          ],
          prompts: ["Book a flight", "Plan a vacation"]
        },
        id: phone_number_id,
        fallback: true
      })
    });

    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
