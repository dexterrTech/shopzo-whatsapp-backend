import { Router } from "express";
import { z } from "zod";
import { withFallback } from "../utils/fallback";
import { env } from "../config/env";

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Phone Numbers
 *     description: WhatsApp Business Account phone number management and profile operations
 */

/**
 * @openapi
 * /api/phone-numbers:
 *   get:
 *     tags:
 *       - Phone Numbers
 *     summary: Get Phone Numbers
 *     description: Get a list of all phone numbers associated with a WhatsApp Business Account. Results are sorted by embedded signup completion date in descending order.
 *     responses:
 *       200:
 *         description: Phone numbers retrieved successfully
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
 *                       code_verification_status:
 *                         type: string
 *                       display_phone_number:
 *                         type: string
 *                       quality_rating:
 *                         type: string
 *                       platform_type:
 *                         type: string
 *                       throughput:
 *                         type: object
 *                         properties:
 *                           level:
 *                             type: string
 *                       last_onboarded_time:
 *                         type: string
 *                       id:
 *                         type: string
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
 *                 fallback:
 *                   type: boolean
 */
// GET /api/phone-numbers - Get all phone numbers
router.get("/", async (req, res, next) => {
  try {
    const data = await withFallback({
      feature: "getPhoneNumbers",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${env.INTERAKT_WABA_ID}/phone_numbers`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Get phone numbers API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        data: [
          {
            verified_name: "Interakt",
            code_verification_status: "VERIFIED",
            display_phone_number: "+91 70215 12345",
            quality_rating: "GREEN",
            platform_type: "CLOUD_API",
            throughput: {
              level: "HIGH"
            },
            last_onboarded_time: "2023-08-31T10:55:37+0000",
            id: "1234567890875"
          }
        ],
        paging: {
          cursors: {
            before: "QVFIUmotZAGczM2w0WElBS3JSbzJwZA2V4OUt3akhmeU83a2FIUEhNV1dEZAUxrSjBLWHppQTI3Mkp6VHd3T3pyQXFMY0RkcDdfeUxGbUthMl9vYzcxSG1fVVF3",
            after: "QVFIUmotZAGczM2w0WElBS3JSbzJwZA2V4OUt3akhmeU83a2FIUEhNV1dEZAUxrSjBLWHppQTI3Mkp6VHd3T3pyQXFMY0RkcDdfeUxGbUthMl9vYzcxSG1fVVF3"
          }
        },
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
 * /api/phone-numbers/subscribed-apps:
 *   get:
 *     tags:
 *       - Phone Numbers
 *     summary: Get All Subscribed Apps for a WABA
 *     description: Get all subscribed applications for a WhatsApp Business Account.
 *     parameters:
 *       - in: query
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *     responses:
 *       200:
 *         description: Subscribed apps retrieved successfully
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
 *                       whatsapp_business_api_data:
 *                         type: object
 *                         properties:
 *                           link:
 *                             type: string
 *                           name:
 *                             type: string
 *                           id:
 *                             type: string
 *                       override_callback_uri:
 *                         type: string
 *                 fallback:
 *                   type: boolean
 */
// GET /api/phone-numbers/subscribed-apps - Get subscribed apps (MUST come before /:phone_number_id)
router.get("/subscribed-apps", async (req, res, next) => {
  try {
    const { phone_number_id } = req.query;

    if (!phone_number_id) {
      return res.status(400).json({ error: "phone_number_id parameter is required" });
    }

    const data = await withFallback({
      feature: "getSubscribedApps",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${env.INTERAKT_WABA_ID}/subscribed_apps`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'x-phone-number-id': phone_number_id as string
          }
        });

        if (!response.ok) {
          throw new Error(`Get subscribed apps API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        data: [
          {
            whatsapp_business_api_data: {
              link: "http://app.interakt.ai/",
              name: "Interakt ISV",
              id: "256725303808337"
            },
            override_callback_uri: "https://example.com/wa/callback.php"
          }
        ],
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
 * /api/phone-numbers/{phone_number_id}:
 *   get:
 *     tags:
 *       - Phone Numbers
 *     summary: Get Single Phone Number Details
 *     description: Get detailed information about a specific phone number including status, verification, and messaging limits.
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *       - in: query
 *         name: fields
 *         required: true
 *         schema:
 *           type: string
 *         description: Comma-separated list of fields to retrieve
 *         example: "status,is_official_business_account,id,name_status,code_verification_status,display_phone_number,platform_type,messaging_limit_tier,throughput"
 *     responses:
 *       200:
 *         description: Phone number details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 is_official_business_account:
 *                   type: boolean
 *                 id:
 *                   type: string
 *                 name_status:
 *                   type: string
 *                 code_verification_status:
 *                   type: string
 *                 display_phone_number:
 *                   type: string
 *                 platform_type:
 *                   type: string
 *                 messaging_limit_tier:
 *                   type: string
 *                 throughput:
 *                   type: object
 *                   properties:
 *                     level:
 *                       type: string
 *                 fallback:
 *                   type: boolean
 */
// GET /api/phone-numbers/:phone_number_id - Get phone number details
router.get("/:phone_number_id", async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const { fields } = req.query;

    if (!fields) {
      return res.status(400).json({ error: "fields parameter is required" });
    }

    const data = await withFallback({
      feature: "getPhoneNumberDetails",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}?fields=${encodeURIComponent(fields as string)}`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Get phone number details API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        status: "CONNECTED",
        is_official_business_account: true,
        id: phone_number_id,
        name_status: "APPROVED",
        code_verification_status: "EXPIRED",
        display_phone_number: "+91 70215 12345",
        platform_type: "CLOUD_API",
        messaging_limit_tier: "TIER_100K",
        throughput: {
          level: "HIGH"
        },
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
 * /api/phone-numbers/{phone_number_id}/whatsapp-business-profile:
 *   get:
 *     tags:
 *       - Phone Numbers
 *     summary: Get WhatsApp Business Profile
 *     description: Get the WhatsApp business profile information including about, address, description, email, and websites.
 *     parameters:
 *       - in: path
 *         name: phone_number_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Phone number ID
 *         example: "112269058640637"
 *       - in: query
 *         name: fields
 *         required: true
 *         schema:
 *           type: string
 *         description: Comma-separated list of profile fields to retrieve
 *         example: "about,address,description,email,profile_picture_url,websites,vertical"
 *     responses:
 *       200:
 *         description: Business profile retrieved successfully
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
 *                       about:
 *                         type: string
 *                       address:
 *                         type: string
 *                       description:
 *                         type: string
 *                       email:
 *                         type: string
 *                       profile_picture_url:
 *                         type: string
 *                       websites:
 *                         type: array
 *                         items:
 *                           type: string
 *                       vertical:
 *                         type: string
 *                       messaging_product:
 *                         type: string
 *                 fallback:
 *                   type: boolean
 */
// GET /api/phone-numbers/:phone_number_id/whatsapp-business-profile
router.get("/:phone_number_id/whatsapp-business-profile", async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const { fields } = req.query;

    if (!fields) {
      return res.status(400).json({ error: "fields parameter is required" });
    }

    const data = await withFallback({
      feature: "getBusinessProfile",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/whatsapp_business_profile?fields=${encodeURIComponent(fields as string)}`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Get business profile API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        data: [
          {
            about: "✅This account is powered by Interakt.shop",
            address: "",
            description: "Search, Sell, Message etc",
            email: "info@interakt.shop",
            profile_picture_url: "https://pps.whatsapp.net/v/t61.24694-24/369533397_322723140293213_1495487253937962747_n.jpg?ccb=11-4&oh=01_AdTa-zpnJ7s93_h9AVlO7QODqDsFr40zqLrnDT-bA1q0Bg&oe=65D61D14&_nc_sid=e6ed6c&_nc_cat=110",
            websites: [
              "https://www.interakt.shop"
            ],
            vertical: "PROF_SERVICES",
            messaging_product: "whatsapp"
          }
        ],
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
 * /api/phone-numbers/{phone_number_id}/health-status:
 *   get:
 *     tags:
 *       - Phone Numbers
 *     summary: Get WABA Health Status
 *     description: Get the health status of a WhatsApp Business Account to determine if messages can be sent successfully.
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
 *         description: Health status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 health_status:
 *                   type: object
 *                   properties:
 *                     can_send_message:
 *                       type: string
 *                       enum: [AVAILABLE, LIMITED, BLOCKED]
 *                     entities:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           entity_type:
 *                             type: string
 *                           id:
 *                             type: string
 *                           can_send_message:
 *                             type: string
 *                           additional_info:
 *                             type: array
 *                             items:
 *                               type: string
 *                           errors:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 error_code:
 *                                   type: integer
 *                                 error_description:
 *                                   type: string
 *                                 possible_solution:
 *                                   type: string
 *                 id:
 *                   type: string
 *                 fallback:
 *                   type: boolean
 */
// GET /api/phone-numbers/:phone_number_id/health-status
router.get("/:phone_number_id/health-status", async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;

    const data = await withFallback({
      feature: "getHealthStatus",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}?fields=health_status`, {
          method: 'GET',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Get health status API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      },
      fallback: () => ({
        health_status: {
          can_send_message: "AVAILABLE",
          entities: [
            {
              entity_type: "PHONE_NUMBER",
              id: phone_number_id,
              can_send_message: "AVAILABLE"
            },
            {
              entity_type: "WABA",
              id: env.INTERAKT_WABA_ID || "mock-waba-id",
              can_send_message: "AVAILABLE"
            },
            {
              entity_type: "BUSINESS",
              id: "mock-business-id",
              can_send_message: "AVAILABLE"
            },
            {
              entity_type: "APP",
              id: "mock-app-id",
              can_send_message: "AVAILABLE"
            }
          ]
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

/**
 * @openapi
 * /api/phone-numbers/{phone_number_id}/whatsapp-business-profile:
 *   post:
 *     tags:
 *       - Phone Numbers
 *     summary: Update Business Profile
 *     description: Update the WhatsApp business profile information including about, address, description, email, and websites.
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
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 enum: [whatsapp]
 *                 description: Always set to "whatsapp"
 *               about:
 *                 type: string
 *                 maxLength: 139
 *                 description: Business about text (1-139 characters)
 *               address:
 *                 type: string
 *                 maxLength: 256
 *                 description: Business address
 *               description:
 *                 type: string
 *                 maxLength: 512
 *                 description: Business description
 *               email:
 *                 type: string
 *                 maxLength: 128
 *                 description: Business email address
 *               profile_picture_handle:
 *                 type: string
 *                 description: Profile picture handle from upload API
 *               vertical:
 *                 type: string
 *                 enum: [UNDEFINED, OTHER, AUTO, BEAUTY, APPAREL, EDU, ENTERTAIN, EVENT_PLAN, FINANCE, GROCERY, GOVT, HOTEL, HEALTH, NONPROFIT, PROF_SERVICES, RETAIL, TRAVEL, RESTAURANT, NOT_A_BIZ]
 *                 description: Industry of the business
 *               websites:
 *                 type: array
 *                 maxItems: 2
 *                 items:
 *                   type: string
 *                   maxLength: 256
 *                 description: Business websites (max 2)
 *     responses:
 *       200:
 *         description: Business profile updated successfully
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
// POST /api/phone-numbers/:phone_number_id/whatsapp-business-profile
router.post("/:phone_number_id/whatsapp-business-profile", async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "updateBusinessProfile",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/whatsapp_business_profile`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Update business profile API error: ${response.status} ${response.statusText}`);
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
 * /api/phone-numbers/{phone_number_id}/register:
 *   post:
 *     tags:
 *       - Phone Numbers
 *     summary: Register Number/Display Name Update
 *     description: Register a phone number or update display name using a PIN.
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
 *               - pin
 *             properties:
 *               messaging_product:
 *                 type: string
 *                 enum: [whatsapp]
 *                 description: Always set to "whatsapp"
 *               pin:
 *                 type: string
 *                 description: PIN for registration
 *     responses:
 *       200:
 *         description: Registration successful
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
// POST /api/phone-numbers/:phone_number_id/register
router.post("/:phone_number_id/register", async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "registerNumber",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}/register`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Register number API error: ${response.status} ${response.statusText}`);
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
 * /api/phone-numbers/{phone_number_id}/webhook-configuration:
 *   post:
 *     tags:
 *       - Phone Numbers
 *     summary: Number-Level Webhook Configuration
 *     description: Configure webhook URL individually for a specific phone number in the WABA.
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
 *               - webhook_configuration
 *             properties:
 *               webhook_configuration:
 *                 type: object
 *                 required:
 *                   - override_callback_uri
 *                   - verify_token
 *                 properties:
 *                   override_callback_uri:
 *                     type: string
 *                     description: Webhook callback URL
 *                   verify_token:
 *                     type: string
 *                     description: Verification token for webhook
 *     responses:
 *       200:
 *         description: Webhook configuration updated successfully
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
// POST /api/phone-numbers/:phone_number_id/webhook-configuration
router.post("/:phone_number_id/webhook-configuration", async (req, res, next) => {
  try {
    const { phone_number_id } = req.params;
    const body = req.body;

    const data = await withFallback({
      feature: "configureWebhook",
      attempt: async () => {
        const response = await fetch(`${env.INTERAKT_AMPED_EXPRESS_BASE_URL}/${phone_number_id}`, {
          method: 'POST',
          headers: {
            'x-access-token': env.INTERAKT_ACCESS_TOKEN || '',
            'x-waba-id': env.INTERAKT_WABA_ID || '',
            'x-phone-number-id': phone_number_id,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          throw new Error(`Configure webhook API error: ${response.status} ${response.statusText}`);
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
