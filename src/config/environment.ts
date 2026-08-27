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
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().min(1).default("octob.reviews"),
  RABBITMQ_INPUT_QUEUE: z.string().min(1).default("octob.review-worker.review.requested"),
  RABBITMQ_RESULTS_QUEUE: z.string().min(1).default("octob.api.review-results"),
  RABBITMQ_DLX: z.string().min(1).default("octob.reviews.dlx"),
  OCTOB_DATA_ENCRYPTION_KEY: z.string().min(1),
  OCTOB_CREDENTIAL_KEY_LOCAL: z.string().min(1),
  ALLOWED_CODEX_MODELS: z.string().min(1),
  DEFAULT_CODEX_MODEL: z.string().min(1),
  CODEX_BINARY: z.string().min(1).default("node_modules/.bin/codex"),
  CODEX_STATUS_TIMEOUT_MS: positiveInt.max(30000).default(10000),
  CODEX_STATUS_CACHE_TTL_MS: positiveInt.max(300000).default(60000),
  MAX_MESSAGE_BYTES: positiveInt.default(262144),
  REVIEW_TIMEOUT_MS: positiveInt.max(900000).default(900000),
  MAX_REVIEW_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RETRY_BASE_DELAY_MS: positiveInt.default(30000),
  PUBLIC_API_URL: z.string().url(),
  CORS_ALLOWED_ORIGINS: z.string().min(1).default("http://localhost:5173"),
  AZURE_DEVOPS_API_VERSION: z.string().default("7.1"),
});

export type Environment = z.infer<typeof schema>;
export function validateEnvironment(value: Record<string, unknown>): Environment {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid API configuration: ${z.prettifyError(result.error)}`);
  for (const name of ["OCTOB_DATA_ENCRYPTION_KEY", "OCTOB_CREDENTIAL_KEY_LOCAL"] as const) {
    if (Buffer.from(result.data[name], "base64").length !== 32) throw new Error(`${name} must contain exactly 32 Base64-encoded bytes`);
  }
  const allowedModels = result.data.ALLOWED_CODEX_MODELS.split(",").map((v) => v.trim());
  if (!allowedModels.includes(result.data.DEFAULT_CODEX_MODEL)) {
    throw new Error("DEFAULT_CODEX_MODEL must be included in ALLOWED_CODEX_MODELS");
  }
  const corsOrigins = result.data.CORS_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean);
  if (!corsOrigins.length || corsOrigins.some((origin) => origin === "*" || !URL.canParse(origin))) {
    throw new Error("CORS_ALLOWED_ORIGINS must contain comma-separated absolute origins and cannot contain *");
  }
  return result.data;
}
