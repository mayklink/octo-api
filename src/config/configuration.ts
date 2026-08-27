import { validateEnvironment } from "./environment";

export default () => {
  const env = validateEnvironment(process.env);
  return {
    app: { environment: env.NODE_ENV, port: env.PORT, publicUrl: env.PUBLIC_API_URL, logLevel: env.LOG_LEVEL, corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean) },
    auth: { issuer: env.SUPABASE_JWT_ISSUER, audience: env.SUPABASE_JWT_AUDIENCE, jwksUrl: `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`, supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY },
    rabbit: { url: env.RABBITMQ_URL, exchange: env.RABBITMQ_EXCHANGE, inputQueue: env.RABBITMQ_INPUT_QUEUE, resultsQueue: env.RABBITMQ_RESULTS_QUEUE, dlx: env.RABBITMQ_DLX },
    secrets: { dataKey: env.OCTOB_DATA_ENCRYPTION_KEY, workerKey: env.OCTOB_CREDENTIAL_KEY_LOCAL },
    review: { allowedModels: env.ALLOWED_CODEX_MODELS.split(",").map((v) => v.trim()), defaultModel: env.DEFAULT_CODEX_MODEL, maxMessageBytes: env.MAX_MESSAGE_BYTES, timeoutMs: env.REVIEW_TIMEOUT_MS, maxAttempts: env.MAX_REVIEW_ATTEMPTS, retryBaseDelayMs: env.RETRY_BASE_DELAY_MS },
    codex: { binary: env.CODEX_BINARY, statusTimeoutMs: env.CODEX_STATUS_TIMEOUT_MS, statusCacheTtlMs: env.CODEX_STATUS_CACHE_TTL_MS, deviceAuthTimeoutMs: env.CODEX_DEVICE_AUTH_TIMEOUT_MS },
    azure: { apiVersion: env.AZURE_DEVOPS_API_VERSION },
  };
};
