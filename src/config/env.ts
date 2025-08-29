import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Resilient env parsing with safe defaults so service can boot and use fallback data
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  PORT: z.string().default("8080"),

  // Facebook / Interakt credentials (placeholders if not provided)
  INTERAKT_WABA_ID: z.string().default("dev_waba_id"),
  INTERAKT_ACCESS_TOKEN: z.string().default("dev_access_token"),
  INTERAKT_PHONE_NUMBER_ID: z.string().default("dev_phone_number_id"),
  INTERAKT_SOLUTION_ID: z.string().default("1985687578474211"),

  // API Base URLs
  FACEBOOK_GRAPH_API_BASE_URL: z.string().default("https://graph.facebook.com"),
  INTERAKT_API_BASE_URL: z.string().default("https://api.interakt.ai"),
  INTERAKT_AMPED_EXPRESS_BASE_URL: z.string().default("https://amped-express.interakt.ai"),
  INTERAKT_BASE_URL: z.string().default("https://interakt.ai"),

  // Facebook App Credentials (for Embedded Signup token exchange)
  APP_ID: z.string().default("2524533311265577"),
  APP_SECRET: z.string().default("f752f6f45e9430e3dd936df1b4d1d83e"),

  // Webhook Configuration
  WEBHOOK_VERIFY_TOKEN: z.string().default("dev-verify-token"),
  WEBHOOK_URL: z.string().default(""),
  
  // Server Configuration
  SERVER_URL: z.string().optional(),

  // Database Configuration (defaults allow boot without external DB)
  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.string().default("5432"),
  DB_NAME: z.string().default("whatsapp_dashboard"),
  DB_USER: z.string().default("postgres"),
  DB_PASSWORD: z.string().default("postgres"),
  DB_CONNECTION_STRING: z
    .string()
    .default("postgresql://postgres:postgres@localhost:5432/whatsapp_dashboard"),

  // Feature Flags
  USE_FALLBACK_WHEN_ERROR: z
    .string()
    .optional()
    .transform((v) => (v ? v.toLowerCase() === "true" : true)),
  
  // API Versions
  FACEBOOK_API_VERSION: z.string().default("v21.0"),
  INTERAKT_API_VERSION: z.string().default("v1"),
  
  // JWT Configuration
  JWT_SECRET: z.string().default("change-me-dev-secret"),
  JWT_EXPIRES_IN: z.string().default("7d"),
});

const parsed = EnvSchema.safeParse(process.env);

export const env = parsed.success ? parsed.data : EnvSchema.parse({});
export const numericPort = Number(process.env.PORT || env.PORT) || 8080;


