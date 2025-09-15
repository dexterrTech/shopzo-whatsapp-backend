import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import interaktRoutes from "./routes/interaktRoutes";
import contactRoutes from "./routes/contactRoutes";
import campaignRoutes from "./routes/campaignRoutes";
import accMatricsRoutes from "./routes/accMatrics";
import phoneNumbersRoutes from "./routes/phoneNumbers";
import conversationalComponentsRoutes from "./routes/conversationalComponents";
import sendMessageRoutes from "./routes/sendMessage";
import authRoutes from "./routes/authRoutes";
import billingRoutes from "./routes/billingRoutes";
import walletRoutes from "./routes/walletRoutes";
import whatsappRoutes from "./routes/whatsappRoutes";
import templateRoutes from "./routes/templateRoutes";
import sendTemplateRoutes from "./routes/sendTemplate";
import uploadRoutes from "./routes/uploads";
import bulkMessagingRoutes from "./routes/bulkMessagingRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import { errorHandler } from "./middleware/errorHandler";
import path from "path";
import { numericPort, env } from "./config/env";
import { WebhookLoggingService } from "./services/webhookLoggingService";
import { pool } from "./config/database";
import { WalletService } from "./services/walletService";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./docs/spec";
import { initDatabase } from "./config/database";
import { authenticateToken } from "./middleware/authMiddleware";

const app = express();

// Enable verbose logs only when LOG_DEBUG=true
const LOG_DEBUG = String(process.env.LOG_DEBUG || '').toLowerCase() === 'true';
const dlog = (...args: any[]) => { if (LOG_DEBUG) console.log(...args); };

// CORS must run before helmet so preflight responses include CORS headers
app.use(cors({
  origin: [
    'http://localhost:3000',  // Allow local development frontend
    'http://127.0.0.1:3000',  // Allow local dev via 127.0.0.1
    'http://localhost:5173',  // Allow Vite preview port
    'https://shopzo-whatsapp-frontend-1-315431551371.europe-west1.run.app', // Allow Vite preview port
    'https://message.shopzo.app', // Allow production
    'https://api.shopzo.app', // Allow API domain
    /^https:\/\/.*\.vercel\.app$/, // Allow Vercel deployments
    /^https:\/\/.*\.netlify\.app$/, // Allow Netlify deployments
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token', 'x-waba-id', 'file_offset'],
}));

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

// Serve uploaded static files (CSV/XLSX) publicly for Interakt to fetch
app.use("/files", (req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
},
  // dist runtime: __dirname is .../dist. Go up one to project root of server build output
  (express as any).static(path.resolve(__dirname, "..", "uploads"))
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV, time: new Date().toISOString() });
});

// Mirror health under /api for proxies that route only /api/*
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV, time: new Date().toISOString(), path: "/api/health" });
});

// Test endpoint to check webhook data (no auth required)
app.get("/api/webhook-test", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        webhook_type, 
        http_method, 
        request_url, 
        query_params, 
        body_data, 
        response_status, 
        created_at,
        event_type,
        phone_number_id,
        waba_id,
        message_id
      FROM webhook_logs 
      ORDER BY created_at DESC 
      LIMIT 10
    `);
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test route to verify API is working
app.get("/api/test", (_req, res) => {
  res.json({ 
    message: "API is working!", 
    timestamp: new Date().toISOString(),
    routes: [
      "/api/interakt/*",
      "/api/contacts/*", 
      "/api/campaigns/*",
      "/api/phone-numbers/*"
    ]
  });
});

// Debug: Log route registration
dlog("Registering routes...");

// Direct webhook route for simpler URL - do not require auth or verify token (per requirement)
app.get("/api/interaktWebhook", (req, res) => {
  const challenge = req.query["hub.challenge"];
  dlog("Webhook verification attempt:", { challenge });
  if (challenge) {
    return res.status(200).send(challenge as any);
  }
  return res.status(200).send("OK");
});

// Facebook webhook verification endpoint
app.get("/api/facebookWebhook", async (req, res) => {
  const startTime = Date.now();
  const mode = req.query["hub.mode"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = req.query["hub.verify_token"];

  let responseStatus = 200;
  let responseData: string | undefined = typeof challenge === 'string' ? challenge : undefined;
  let errorMessage: string | undefined;

  try {
    // Check if this is a subscription verification request
    if (mode === "subscribe" && verifyToken === "DexterrTechnologies@12345") {
      dlog("Facebook webhook verified successfully");
      res.status(200).send(challenge);
    } else {
      dlog("Facebook webhook verification failed");
      responseStatus = 403;
      responseData = "Forbidden";
      errorMessage = "Invalid verification";
      res.status(403).send("Forbidden");
    }
  } catch (error: any) {
    console.error("Facebook webhook verification error:", error);
    responseStatus = 500;
    responseData = "Internal Server Error";
    errorMessage = error.message;
    res.status(500).send("Internal Server Error");
  } finally {
    // Log the webhook verification attempt to database
    const processingTime = Date.now() - startTime;
    await WebhookLoggingService.logWebhook({
      webhook_type: 'verification',
      http_method: req.method,
      request_url: req.originalUrl,
      query_params: req.query,
      headers: req.headers,
      response_status: responseStatus,
      response_data: responseData,
      processing_time_ms: processingTime,
      error_message: errorMessage,
      event_type: typeof mode === 'string' ? mode : undefined
    });
  }
});

// Facebook webhook data receiver
app.post("/api/facebookWebhook", async (req, res) => {
  const startTime = Date.now();
  const body = req.body;
  dlog("Facebook webhook received:", JSON.stringify(body, null, 2));

  let responseStatus = 200;
  let responseData = "OK";
  let errorMessage: string | undefined;

  try {
    // Handle webhook events from Facebook
    if (body.object === "whatsapp_business_account") {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach(async (change: any) => {
          if (change.value?.messages) {
            dlog("Facebook incoming message:", change.value.messages);
          }
          if (change.value?.statuses) {
            dlog("Facebook message status update:", change.value.statuses);
          }
        });
      });
    }

    res.sendStatus(200);
  } catch (error: any) {
    console.error("Error processing Facebook webhook:", error);
    responseStatus = 500;
    responseData = "Internal Server Error";
    errorMessage = error.message;
    res.sendStatus(500);
  } finally {
    // Log the webhook data to database
    const processingTime = Date.now() - startTime;
    const webhookType = WebhookLoggingService.determineWebhookType(req, body);
    const extractedData = WebhookLoggingService.extractWebhookData(body);
    
    await WebhookLoggingService.logWebhook({
      webhook_type: webhookType,
      http_method: req.method,
      request_url: req.originalUrl,
      query_params: req.query,
      headers: req.headers,
      body_data: body,
      response_status: responseStatus,
      response_data: responseData,
      processing_time_ms: processingTime,
      error_message: errorMessage,
      ...extractedData
    });
  }
});

// Mirror POST webhook on the same direct path so external services can POST here
// This calls the actual webhook processing logic from interaktRoutes
app.post("/api/interaktWebhook", async (req, res) => {
  const startTime = Date.now();
  const body = req.body;
  dlog("Direct webhook received (POST /api/interaktWebhook):", JSON.stringify(body, null, 2));

  // Determine webhook type and extract relevant data
  const webhookType = WebhookLoggingService.determineWebhookType(req, body);
  const extractedData = WebhookLoggingService.extractWebhookData(body);

  let responseStatus = 200;
  let responseData = "OK";
  let errorMessage: string | undefined;

  try {
    // Handle different webhook events
    if (body.object === "whatsapp_business_account") {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach(async (change: any) => {
          if (change.value?.messages) {
            // Handle incoming messages
            dlog("Incoming message:", change.value.messages);
          }
          if (change.value?.statuses) {
            // Handle message status updates for settlement from suspense
            const statuses = change.value.statuses as any[];
            const phoneNumberId: string | undefined = change?.value?.metadata?.phone_number_id;
            let userId: number | undefined;
            try {
              if (phoneNumberId) {
                const r = await pool.query('SELECT user_id FROM whatsapp_setups WHERE phone_number_id = $1 LIMIT 1', [phoneNumberId]);
                userId = r.rows[0]?.user_id;
              }
            } catch (e) {
              console.warn('Failed to resolve user from phone_number_id:', phoneNumberId, e);
            }

            for (const st of statuses) {
              const conversationId: string | undefined = st?.id || st?.message_id || st?.conversation?.id;
              const status: string | undefined = st?.status;
              if (!conversationId || !status) continue;

              dlog(`Processing webhook status: ${status} for conversation: ${conversationId}, user: ${userId}`);
              console.log('[Webhook][Direct] status event', {
                status,
                conversationId,
                messageId: st?.message_id,
                convObjId: st?.conversation?.id,
                recipient: st?.recipient_id,
                phoneNumberId,
                userIdResolved: !!userId,
              });
              if (!userId) {
                console.warn('[Webhook][Direct] Skipping settlement - could not resolve userId from phone_number_id', { phoneNumberId, conversationId, status });
              }

              try {
                // Check for idempotency - avoid double processing
                if (userId) {
                  let existingLog = await pool.query(
                    'SELECT id, billing_status FROM billing_logs WHERE conversation_id = $1 AND user_id = $2',
                    [conversationId, userId]
                  );
                  if (existingLog.rows.length === 0) {
                    // Fallback: try matching by recipient number recent pending
                    const recipient = (st?.recipient_id || '').replace(/\D/g, '');
                    if (recipient) {
                      const fb = await pool.query(
                        `SELECT id, billing_status, conversation_id
                         FROM billing_logs
                         WHERE user_id = $1
                           AND REGEXP_REPLACE(recipient_number, '[^0-9]', '', 'g') = $2
                           AND billing_status = 'pending'
                         ORDER BY created_at DESC NULLS LAST, id DESC
                         LIMIT 1`,
                        [userId, recipient]
                      );
                      if (fb.rows.length > 0) {
                        console.warn('[Webhook][Direct] Fallback matched pending billing_log by recipient; updating conversation_id', { userId, oldConversationId: fb.rows[0].conversation_id, newConversationId: conversationId, recipient });
                        await pool.query('UPDATE billing_logs SET conversation_id = $1 WHERE id = $2', [conversationId, fb.rows[0].id]);
                        existingLog = { rows: [{ id: fb.rows[0].id, billing_status: 'pending' }] } as any;
                      } else {
                        console.warn('[Webhook][Direct] No billing_log found for conversation/user; cannot settle', { userId, conversationId, status, recipient });
                      }
                    } else {
                      console.warn('[Webhook][Direct] No billing_log found and no recipient for fallback', { userId, conversationId, status });
                    }
                  }
                  if (existingLog.rows.length > 0 && 
                      (existingLog.rows[0].billing_status === 'paid' || existingLog.rows[0].billing_status === 'failed')) {
                    dlog(`Settlement already processed for conversation ${conversationId}, skipping`);
                    continue;
                  }
                }

                // Settle only for template sends using suspense model
                if (userId) {
                  if (status === 'failed') {
                    // Refund from suspense back to wallet
                    dlog(`Refunding failed message ${conversationId} for user ${userId}`);
                    await WalletService.confirmMessageDelivery(userId, conversationId, false);
                  } else if (status === 'sent' || status === 'delivered' || status === 'read') {
                    // Mark paid (kept in suspense per current model)
                    dlog(`Confirming ${status} message ${conversationId} for user ${userId}`);
                    await WalletService.confirmMessageDelivery(userId, conversationId, true);
                  }
                }
              } catch (e) {
                console.warn('Settlement from webhook failed for', { userId, conversationId, status }, e);
              }
            }
          }
        });
      });
    }

    // Handle tech partner events
    if (body.object === "tech_partner") {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          if (change.value?.event === "PARTNER_ADDED") {
            dlog("PARTNER_ADDED event received:", change.value);
          }
        });
      });
    }

    res.sendStatus(200);
  } catch (error: any) {
    console.error("Direct webhook handler error:", error);
    responseStatus = 500;
    responseData = "Internal Server Error";
    errorMessage = error.message;
    res.sendStatus(500);
  } finally {
    // Log the webhook data to database
    const processingTime = Date.now() - startTime;
    await WebhookLoggingService.logWebhook({
      webhook_type: webhookType,
      http_method: req.method,
      request_url: req.originalUrl,
      query_params: req.query,
      headers: req.headers,
      body_data: body,
      response_status: responseStatus,
      response_data: responseData,
      processing_time_ms: processingTime,
      error_message: errorMessage,
      ...extractedData
    });
  }
});

// Global auth gate: require JWT for all routes except allowlist
app.use((req, res, next) => {
  const allowlist: RegExp[] = [
    /^\/health$/,
    /^\/api\/health$/,
    /^\/api\/webhook-test$/, // Added webhook test endpoint
    /^\/api\/test$/,
    /^\/docs(\.json)?$/,
    /^\/docs\/?/,
    /^\/api\/docs(\.json)?$/,
    /^\/api\/docs\/?/,
    /^\/api\/auth\/register$/,
    /^\/api\/auth\/login$/,
    /^\/api\/interaktWebhook$/,
    /^\/api\/interakt\/interaktWebhook$/,
    /^\/api\/facebookWebhook$/,
  ];
  if (req.method === 'OPTIONS') return next();
  if (allowlist.some((rx) => rx.test(req.path))) return next();
  return authenticateToken(req as any, res as any, next as any);
});

app.use("/api/auth", authRoutes);
// Remove misplaced placeholder for billing
app.use("/api/interakt", interaktRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/acc-matrics", accMatricsRoutes);
app.use("/api/phone-numbers", phoneNumbersRoutes);
app.use("/api/conversational-components", conversationalComponentsRoutes);
app.use("/api/send-message", sendMessageRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/templates", templateRoutes);
app.use("/api/send-template", sendTemplateRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/bulk-messages", bulkMessagingRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Billing routes (after auth so we can protect with middleware)
app.use("/api/billing", billingRoutes);
app.use("/api/wallet", walletRoutes);

dlog("Routes registered successfully");

// Debug: Log Swagger spec
dlog("Swagger spec generated:", Object.keys((swaggerSpec as any).paths || {}).length, "endpoints");

// Check if required environment variables are set
const requiredEnvVars = [
  'INTERAKT_WABA_ID',
  'INTERAKT_ACCESS_TOKEN', 
  'INTERAKT_PHONE_NUMBER_ID',
  'WEBHOOK_VERIFY_TOKEN'
];

// Log server configuration
dlog('🌐 Server Configuration:');
dlog(`   Environment: ${env.NODE_ENV}`);
dlog(`   Process NODE_ENV: ${process.env.NODE_ENV}`);
dlog(`   Port: ${env.PORT} (numericPort: ${numericPort})`);
dlog(`   Server URL: ${env.SERVER_URL || 'Not set (using localhost)'}`);
dlog(`   Swagger will show: ${env.SERVER_URL ? `${env.SERVER_URL} and localhost:${env.PORT}` : `localhost:${env.PORT} only`}`);
dlog(`   Running from: ${__dirname}`);
dlog(`   Swagger will scan both .ts and .js files for compatibility`);

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.warn("⚠️  Missing environment variables:", missingEnvVars);
  console.warn("Some features may not work properly in development mode");
}

// Swagger docs (root and under /api for proxies that only forward /api/*)
app.get("/docs.json", (_req, res) => {
  res.json(swaggerSpec);
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get("/api/docs.json", (_req, res) => {
  res.json(swaggerSpec);
});
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(errorHandler);

// Initialize server first for platform health checks, then initialize database in background
async function startServer() {
  app.listen(numericPort, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${numericPort}`);
    dlog(`Swagger docs available at http://localhost:${numericPort}/docs and /api/docs`);
  });

  try {
    await initDatabase();
    console.log("Database initialized successfully");
  } catch (error) {
    console.error('Database initialization failed (continuing with fallback):', error);
  }
}

startServer();

