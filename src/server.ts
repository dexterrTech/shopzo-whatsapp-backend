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
import { errorHandler } from "./middleware/errorHandler";
import { numericPort, env } from "./config/env";
import { pool } from "./config/database";
import { WalletService } from "./services/walletService";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./docs/spec";
import { initDatabase } from "./config/database";
import { authenticateToken } from "./middleware/authMiddleware";
import { WebhookLoggingService } from "./services/webhookLoggingService";

const app = express();

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
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token', 'x-waba-id'],
}));

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

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
console.log("Registering routes...");

// Direct webhook route for simpler URL - do not require auth or verify token (per requirement)
app.get("/api/interaktWebhook", (req, res) => {
  const challenge = req.query["hub.challenge"];
  console.log("Webhook verification attempt:", { challenge });
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
      console.log("Facebook webhook verified successfully");
      res.status(200).send(challenge);
    } else {
      console.log("Facebook webhook verification failed");
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
  console.log("Facebook webhook received:", JSON.stringify(body, null, 2));

  let responseStatus = 200;
  let responseData = "OK";
  let errorMessage: string | undefined;

  try {
    // Handle webhook events from Facebook
    if (body.object === "whatsapp_business_account") {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach(async (change: any) => {
          if (change.value?.messages) {
            console.log("Facebook incoming message:", change.value.messages);
          }
          if (change.value?.statuses) {
            console.log("Facebook message status update:", change.value.statuses);
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
  try {
    console.log("Direct webhook received (POST /api/interaktWebhook):", JSON.stringify(req.body, null, 2));
    
    // Call the actual webhook processing logic
    const body = req.body;
    
    // Handle different webhook events
    if (body.object === "whatsapp_business_account") {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach(async (change: any) => {
          if (change.value?.messages) {
            // Handle incoming messages
            console.log("Incoming message:", change.value.messages);
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

              console.log(`Processing webhook status: ${status} for conversation: ${conversationId}, user: ${userId}`);

              try {
                // Check for idempotency - avoid double processing
                if (userId) {
                  const existingLog = await pool.query(
                    'SELECT billing_status FROM billing_logs WHERE conversation_id = $1 AND user_id = $2',
                    [conversationId, userId]
                  );
                  
                  if (existingLog.rows.length > 0 && 
                      (existingLog.rows[0].billing_status === 'paid' || existingLog.rows[0].billing_status === 'failed')) {
                    console.log(`Settlement already processed for conversation ${conversationId}, skipping`);
                    continue;
                  }
                }

                // Settle only for template sends using suspense model
                if (userId) {
                  if (status === 'failed') {
                    // Refund from suspense back to wallet
                    console.log(`Refunding failed message ${conversationId} for user ${userId}`);
                    await WalletService.confirmMessageDelivery(userId, conversationId, false);
                  } else if (status === 'sent' || status === 'delivered') {
                    // Mark paid (kept in suspense per current model)
                    console.log(`Confirming ${status} message ${conversationId} for user ${userId}`);
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
            console.log("PARTNER_ADDED event received:", change.value);
          }
        });
      });
    }
    
    return res.sendStatus(200);
  } catch (e) {
    console.error("Direct webhook handler error:", e);
    return res.sendStatus(500);
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

// Billing routes (after auth so we can protect with middleware)
app.use("/api/billing", billingRoutes);
app.use("/api/wallet", walletRoutes);

console.log("Routes registered successfully");

// Debug: Log Swagger spec
console.log("Swagger spec generated:", Object.keys((swaggerSpec as any).paths || {}).length, "endpoints");

// Check if required environment variables are set
const requiredEnvVars = [
  'INTERAKT_WABA_ID',
  'INTERAKT_ACCESS_TOKEN', 
  'INTERAKT_PHONE_NUMBER_ID',
  'WEBHOOK_VERIFY_TOKEN'
];

// Log server configuration
console.log('🌐 Server Configuration:');
console.log(`   Environment: ${env.NODE_ENV}`);
console.log(`   Process NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`   Port: ${env.PORT} (numericPort: ${numericPort})`);
console.log(`   Server URL: ${env.SERVER_URL || 'Not set (using localhost)'}`);
console.log(`   Swagger will show: ${env.SERVER_URL ? `${env.SERVER_URL} and localhost:${env.PORT}` : `localhost:${env.PORT} only`}`);
console.log(`   Running from: ${__dirname}`);
console.log(`   Swagger will scan both .ts and .js files for compatibility`);

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
    console.log(`Swagger docs available at http://localhost:${numericPort}/docs and /api/docs`);
  });

  try {
    await initDatabase();
    console.log("Database initialized successfully");
  } catch (error) {
    console.error('Database initialization failed (continuing with fallback):', error);
  }
}

startServer();

