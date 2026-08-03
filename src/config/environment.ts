import { z } from "zod";

const positiveInt = z.coerce.number().int().positive();
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_JWT_ISSUER: z.string().url(),
  SUPABASE_JWT_AUDIENCE: z.string().min(1).default("authenticated"),
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().min(1).default("octob.reviews"),
  RABBITMQ_INPUT_QUEUE: z.string().min(1).default("octob.review-worker.review.requested"),
  RABBITMQ_RESULTS_QUEUE: z.string().min(1).default("octob.api.review-results"),
  RABBITMQ_DLX: z.string().min(1).default("octob.reviews.dlx"),
  OCTOB_DATA_ENCRYPTION_KEY: z.string().min(1),
  OCTOB_CREDENTIAL_KEY_LOCAL: z.string().min(1),
  E2B_API_KEY: z.string().min(1),
  E2B_TEMPLATE_NAME: z.string().min(1).default("octob-review-worker"),
  ALLOWED_CODEX_MODELS: z.string().min(1),
  DEFAULT_CODEX_MODEL: z.string().min(1),
  MAX_MESSAGE_BYTES: positiveInt.default(262144),
  REVIEW_TIMEOUT_MS: positiveInt.max(900000).default(900000),
  MAX_REVIEW_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RETRY_BASE_DELAY_MS: positiveInt.default(30000),
  PUBLIC_API_URL: z.string().url(),
  AZURE_DEVOPS_API_VERSION: z.string().default("7.1"),
});

export type Environment = z.infer<typeof schema>;
export function validateEnvironment(value: Record<string, unknown>): Environment {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid API configuration: ${z.prettifyError(result.error)}`);
  for (const name of ["OCTOB_DATA_ENCRYPTION_KEY", "OCTOB_CREDENTIAL_KEY_LOCAL"] as const) {
    if (Buffer.from(result.data[name], "base64").length !== 32) throw new Error(`${name} must contain exactly 32 Base64-encoded bytes`);
  }
  if (!result.data.ALLOWED_CODEX_MODELS.split(",").map((v) => v.trim()).includes(result.data.DEFAULT_CODEX_MODEL)) {
    throw new Error("DEFAULT_CODEX_MODEL must be included in ALLOWED_CODEX_MODELS");
  }
  return result.data;
}
