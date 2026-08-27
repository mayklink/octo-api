import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { validateEnvironment } from "../src/config/environment";
import { WebhookRateLimitMiddleware } from "../src/modules/webhooks/webhook-rate-limit.middleware";

const validEnvironment = {
  DATABASE_URL: "postgresql://localhost/octob",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_JWT_ISSUER: "https://example.supabase.co/auth/v1",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  RABBITMQ_URL: "amqp://localhost",
  OCTOB_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  OCTOB_CREDENTIAL_KEY_LOCAL: Buffer.alloc(32, 1).toString("base64"),
  ALLOWED_CODEX_MODELS: "model-a",
  DEFAULT_CODEX_MODEL: "model-a",
  PUBLIC_API_URL: "https://api.example.com",
};

describe("HTTP security configuration", () => {
  it("allows the local and official production frontends by default", () => {
    expect(validateEnvironment(validEnvironment).CORS_ALLOWED_ORIGINS).toBe("http://localhost:5173,https://octoreview.vercel.app");
  });

  it("accepts explicit CORS origins and rejects wildcards", () => {
    expect(validateEnvironment({ ...validEnvironment, CORS_ALLOWED_ORIGINS: "https://app.example.com" }).CORS_ALLOWED_ORIGINS).toBe("https://app.example.com");
    expect(() => validateEnvironment({ ...validEnvironment, CORS_ALLOWED_ORIGINS: "*" })).toThrow(/CORS_ALLOWED_ORIGINS/);
  });

  it("rate limits repeated webhook requests from the same client", () => {
    const middleware = new WebhookRateLimitMiddleware();
    const request = { ip: "203.0.113.10", socket: {} } as Request;
    const next = vi.fn() as NextFunction;
    const response = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    for (let index = 0; index < 61; index += 1) middleware.use(request, response, next);

    expect(next).toHaveBeenCalledTimes(60);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: "RATE_LIMITED" }));
  });
});
