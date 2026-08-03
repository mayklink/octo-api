import { validateEnvironment } from "./environment";

export default () => {
  const env = validateEnvironment(process.env);
  return {
    app: { environment: env.NODE_ENV, port: env.PORT, publicUrl: env.PUBLIC_API_URL, logLevel: env.LOG_LEVEL },
    auth: { issuer: env.SUPABASE_JWT_ISSUER, audience: env.SUPABASE_JWT_AUDIENCE, jwksUrl: `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json` },
    rabbit: { url: env.RABBITMQ_URL, exchange: env.RABBITMQ_EXCHANGE, inputQueue: env.RABBITMQ_INPUT_QUEUE, resultsQueue: env.RABBITMQ_RESULTS_QUEUE, dlx: env.RABBITMQ_DLX },
    secrets: { dataKey: env.OCTOB_DATA_ENCRYPTION_KEY, workerKey: env.OCTOB_CREDENTIAL_KEY_LOCAL },
    e2b: { apiKey: env.E2B_API_KEY, template: env.E2B_TEMPLATE_NAME },
    review: { allowedModels: env.ALLOWED_CODEX_MODELS.split(",").map((v) => v.trim()), defaultModel: env.DEFAULT_CODEX_MODEL, maxMessageBytes: env.MAX_MESSAGE_BYTES, timeoutMs: env.REVIEW_TIMEOUT_MS, maxAttempts: env.MAX_REVIEW_ATTEMPTS, retryBaseDelayMs: env.RETRY_BASE_DELAY_MS },
    azure: { apiVersion: env.AZURE_DEVOPS_API_VERSION },
  };
};
