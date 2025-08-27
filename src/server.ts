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
import { errorHandler } from "./middleware/errorHandler";
import { numericPort, env } from "./config/env";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./docs/spec";
import { initDatabase } from "./config/database";
import { authenticateToken } from "./middleware/authMiddleware";

const app = express();

// CORS handling - MUST be FIRST, before any other middleware
app.use((req, res, next) => {
  console.log('🌐 CORS Debug:', {
    origin: req.headers.origin,
    method: req.method,
    path: req.path
  });
  
  // Set CORS headers for ALL requests immediately
  res.setHeader('Access-Control-Allow-Origin', 'https://message.shopzo.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-access-token, x-waba-id, Origin, Accept');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight OPTIONS request immediately
  if (req.method === 'OPTIONS') {
    console.log('🔄 Handling OPTIONS preflight request');
    res.status(204).end();
    return;
  }
  
  next();
});

// CORS middleware as backup (but manual headers should handle it first)
app.use(cors({
  origin: 'https://message.shopzo.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token', 'x-waba-id', 'Origin', 'Accept'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV, time: new Date().toISOString() });
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

// Global auth gate: require JWT for all routes except allowlist
app.use((req, res, next) => {
  const allowlist: RegExp[] = [
    /^\/health$/,
    /^\/api\/test$/,
    /^\/docs(\.json)?$/,
    /^\/docs\/?/,
    /^\/api\/auth\/register$/,
    /^\/api\/auth\/login$/,
    /^\/api\/interaktWebhook$/,
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

// Swagger docs
app.get("/docs.json", (_req, res) => {
  res.json(swaggerSpec);
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use(errorHandler);

// Initialize server first for platform health checks, then initialize database in background
async function startServer() {
  app.listen(numericPort, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${numericPort}`);
    console.log(`Swagger docs available at http://localhost:${numericPort}/docs`);
  });

  try {
    await initDatabase();
    console.log("Database initialized successfully");
  } catch (error) {
    console.error('Database initialization failed (continuing with fallback):', error);
  }
}

startServer();


