import { ConfigService } from "@nestjs/config";
import { createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CredentialsService } from "../src/modules/credentials/credentials.service";
import type { ReviewRequestedV2 } from "../src/modules/contracts/review-contracts";

const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64");
const service = new CredentialsService(new ConfigService({ secrets: { dataKey: key, workerKey: key } }), {} as never);
const request = { eventId: "evt-contract-001", jobId: "job-contract-001", organizationId: "org-contract", repositoryId: "repo-contract", provider: "azure-devops", clone: { url: "https://dev.azure.com/example/project/_git/repository" }, engine: { kind: "codex", model: "gpt-5.6-sol", encryptedCredential: {} } } as ReviewRequestedV2;

describe("credentials", () => {
  it("builds a worker envelope bound to the exact AAD", () => {
    const plaintext = { git: { username: "octob", password: "test-pat" } };
    const envelope = service.createWorkerEnvelope(request, "source-control", plaintext);
    const aad = ["octob.review.v2", "source-control", request.eventId, request.jobId, request.organizationId, request.repositoryId, request.provider, request.clone.url, request.engine.kind, request.engine.model, "local"].join("\0");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    const decoded = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    expect(JSON.parse(decoded.toString("utf8"))).toEqual(plaintext);
  });
  it("uses high entropy webhook tokens and constant-time hashes", () => { const generated = service.generateWebhookSecret(); expect(generated.secret.length).toBeGreaterThan(32); expect(service.matchesWebhookSecret(generated.secret, generated.hash)).toBe(true); expect(service.matchesWebhookSecret(`${generated.secret}x`, generated.hash)).toBe(false); });
  it("normalizes API-key mode without retaining unrelated fields", () => {
    expect(service.normalizeCodexConfiguration("api_key", undefined, "  sk-test-key  ")).toEqual({
      mode: "api_key",
      value: { auth_mode: "apikey", OPENAI_API_KEY: "sk-test-key" },
    });
  });
  it("keeps accepting the legacy ChatGPT authJson payload", () => {
    const authJson = { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { access_token: "access", refresh_token: "refresh", account_id: "account" } };
    expect(service.normalizeCodexConfiguration(undefined, authJson, undefined)).toEqual({ mode: "chatgpt", value: authJson });
  });
  it("rejects empty, ambiguous, and mixed Codex credentials", () => {
    expect(() => service.normalizeCodexConfiguration(undefined, undefined, undefined)).toThrow(/exactly one/);
    expect(() => service.normalizeCodexConfiguration("api_key", {}, "sk-test")).toThrow(/exactly one/);
    expect(() => service.validateCodexAuth({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test", tokens: {} })).toThrow(/must not include/);
  });
});
