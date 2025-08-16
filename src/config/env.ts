import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("8000"),

  // Facebook Graph API credentials (from sir's curl command)
  INTERAKT_WABA_ID: z.string().optional(),
  INTERAKT_ACCESS_TOKEN: z.string().optional(),
  INTERAKT_PHONE_NUMBER_ID: z.string().optional(),

  // API Base URLs
  FACEBOOK_GRAPH_API_BASE_URL: z.string().default("https://graph.facebook.com/v22.0"),
  INTERAKT_API_BASE_URL: z.string().default("https://api.interakt.ai"),
  INTERAKT_AMPED_EXPRESS_BASE_URL: z.string().default("https://interakt-amped-express.azurewebsites.net/api/v17.0"),
  INTERAKT_BASE_URL: z.string().default("https://amped-express.interakt.ai/api/v17.0"),

  // Webhook Configuration
  WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WEBHOOK_URL: z.string().optional(),

  // Feature Flags
  USE_FALLBACK_WHEN_ERROR: z
    .string()
    .optional()
    .transform((v) => (v ? v.toLowerCase() === "true" : true)),
  
  // API Versions
  FACEBOOK_API_VERSION: z.string().default("v22.0"),
  INTERAKT_API_VERSION: z.string().default("v17.0"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Do not throw to allow app boot even with missing creds; we rely on fallbacks
  // eslint-disable-next-line no-console
  console.warn("[env] Invalid environment variables; falling back to defaults", parsed.error.issues);
}

export const env = (parsed.success ? parsed.data : (EnvSchema.parse({}) as any)) as z.infer<typeof EnvSchema>;

export const numericPort = Number(env.PORT) || 8000;


