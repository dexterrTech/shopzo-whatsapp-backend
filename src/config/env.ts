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

  WEBHOOK_VERIFY_TOKEN: z.string().optional(),

  USE_FALLBACK_WHEN_ERROR: z
    .string()
    .optional()
    .transform((v) => (v ? v.toLowerCase() === "true" : true)),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Do not throw to allow app boot even with missing creds; we rely on fallbacks
  // eslint-disable-next-line no-console
  console.warn("[env] Invalid environment variables; falling back to defaults", parsed.error.issues);
}

export const env = (parsed.success ? parsed.data : (EnvSchema.parse({}) as any)) as z.infer<typeof EnvSchema>;

export const numericPort = Number(env.PORT) || 8000;


