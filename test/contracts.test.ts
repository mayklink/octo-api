import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { ContractsService } from "../src/modules/contracts/contracts.service";
import type { ReviewRequestedV2 } from "../src/modules/contracts/review-contracts";

const config = new ConfigService({ review: { maxMessageBytes: 262144 } });
const contracts = new ContractsService(config);
const credential = { algorithm: "A256GCM" as const, keyId: "local", iv: "AAECAwQFBgcICQoL", ciphertext: "eA==", authTag: "h5oeydeBRpHamb35EOGL+Q==" };
const request: ReviewRequestedV2 = {
  schemaVersion: 2, eventId: "event", jobId: "job", attempt: 1, correlationId: "correlation", organizationId: "organization", repositoryId: "repository", provider: "azure-devops", pullRequestId: "42",
  sourceCommit: "a".repeat(40), targetCommit: "b".repeat(40), sourceBranch: "refs/heads/feature", targetBranch: "refs/heads/main", clone: { url: "https://dev.azure.com/example/project/_git/repository" },
  sourceControl: { encryptedCredential: credential }, context: { sections: [{ title: "Pull request", content: "{}" }] }, engine: { kind: "codex", model: "gpt-5.6-sol", encryptedCredential: credential }, settings: { prompt: "Review this change" }, createdAt: "2026-08-02T12:00:00.000Z", deadlineAt: "2026-08-02T12:15:00.000Z",
};

describe("worker v2 contracts", () => {
  it("accepts a valid review.requested", () => { expect(() => contracts.assertRequest(request)).not.toThrow(); });
  it("rejects abbreviated commits and unknown fields", () => { expect(() => contracts.assertRequest({ ...request, sourceCommit: "abc", extra: true })).toThrow(/Invalid review.requested.v2/); });
  it("rejects a credential keyId not accepted by the worker", () => {
    expect(() => contracts.assertRequest({ ...request, sourceControl: { encryptedCredential: { ...credential, keyId: "invalid key" } } })).toThrow(/Invalid review.requested.v2/);
  });
  it("accepts the worker maximum summary length", () => {
    const event = {
      schemaVersion: 2, eventId: "out", causationId: "event", correlationId: "correlation", jobId: "job", attempt: 1,
      organizationId: "organization", repositoryId: "repository", pullRequestId: "42", sourceCommit: "a".repeat(40), targetCommit: "b".repeat(40), findings: [],
      summary: { markdown: "x".repeat(20000), filesReviewed: 0, findingsBySeverity: { info: 0, warning: 0, error: 0 }, truncated: false },
      engine: { name: "codex", model: "gpt-5.6-sol" }, policyVersion: "static-review-v2",
      timings: { totalMs: 1, azureMs: 0, repositoryMs: 0, contextMs: 0, engineMs: 1 }, startedAt: "2026-08-02T12:00:00.000Z", completedAt: "2026-08-02T12:01:00.000Z",
    };
    expect(() => contracts.parseOutcome(Buffer.from(JSON.stringify(event)), "review.completed")).not.toThrow();
  });
  it("enforces failure routing semantics", () => {
    const event = { schemaVersion: 2, eventType: "review.attempt_failed", eventId: "out", causationId: "event", correlationId: "correlation", jobId: "job", attempt: 1, failure: { code: "GIT_FETCH_UNAVAILABLE", category: "infrastructure", retryable: false, message: "Unavailable" }, failedAt: "2026-08-02T12:01:00.000Z" };
    expect(() => contracts.parseOutcome(Buffer.from(JSON.stringify(event)), "review.attempt_failed")).toThrow(/must be retryable/);
  });
});
