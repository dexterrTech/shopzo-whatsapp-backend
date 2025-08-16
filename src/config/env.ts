import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("8000"),

  // Facebook Graph API credentials (from sir's curl command)
  INTERAKT_WABA_ID: z.string(),
  INTERAKT_ACCESS_TOKEN: z.string(),
  INTERAKT_PHONE_NUMBER_ID: z.string(),

  // API Base URLs
  FACEBOOK_GRAPH_API_BASE_URL: z.string(),
  INTERAKT_API_BASE_URL: z.string(),
  INTERAKT_AMPED_EXPRESS_BASE_URL: z.string(),
  INTERAKT_BASE_URL: z.string(),

  // Webhook Configuration
  WEBHOOK_VERIFY_TOKEN: z.string(),
  WEBHOOK_URL: z.string(),

  // Database Configuration
  DB_HOST: z.string(),
  DB_PORT: z.string(),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_CONNECTION_STRING: z.string(), // Changed from optional to required

  // Feature Flags
  USE_FALLBACK_WHEN_ERROR: z
    .string()
    .optional()
    .transform((v) => (v ? v.toLowerCase() === "true" : true)),
  
  // API Versions
  FACEBOOK_API_VERSION: z.string(),
  INTERAKT_API_VERSION: z.string(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[env] Invalid environment variables:", parsed.error.issues);
  console.error("[env] Please check your .env file and ensure all required variables are set");
  process.exit(1);
}

export const env = parsed.data;
export const numericPort = Number(env.PORT) || 8000;


