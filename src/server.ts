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
import { errorHandler } from "./middleware/errorHandler";
import { numericPort, env } from "./config/env";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./docs/spec";
import { initDatabase } from "./config/database";
import { authenticateToken } from "./middleware/authMiddleware";

const app = express();

// CORS must run before helmet so preflight responses include CORS headers
app.use(cors({
  origin: [
    'http://localhost:3000',  // Allow local development frontend
    'http://localhost:5173',  // Allow Vite preview port
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
    /^\/api\/health$/,
    /^\/api\/test$/,
    /^\/docs(\.json)?$/,
    /^\/docs\/?/,
    /^\/api\/docs(\.json)?$/,
    /^\/api\/docs\/?/,
    /^\/api\/auth\/register$/,
    /^\/api\/auth\/login$/,
    /^\/api\/interaktWebhook$/,
    /^\/api\/interakt\/interaktWebhook$/,
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

