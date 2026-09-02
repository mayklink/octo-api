import { describe, expect, it, vi } from "vitest";
import { WebhooksService } from "../src/modules/webhooks/webhooks.service";

const baseRepository = { id: "repo-1", name: "repo-1", organizationId: "org-1", azureRepositoryId: "azure-repo-1", azureProjectId: "azure-project-1", webhookSecretHash: "hash", settings: { autoReview: true } };

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    eventType: "git.pullrequest.created",
    resource: { repository: { id: "azure-repo-1", project: { id: "azure-project-1" } }, pullRequestId: 42 },
    ...overrides,
  };
}

function buildService(options: { repository?: unknown; tokenMatches?: boolean; storedEvent?: any } = {}) {
  const prisma = {
    webhookEvent: {
      findUnique: vi.fn().mockResolvedValue(options.storedEvent ?? null),
      create: vi.fn().mockImplementation(({ data }) => ({ id: "stored-1", processedAt: null, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "stored-1", ...data })),
    },
  };
  const credentials = { matchesWebhookSecret: vi.fn().mockReturnValue(options.tokenMatches ?? true) };
  const repositories = { findByIdWithSettings: vi.fn().mockResolvedValue(options.repository === undefined ? baseRepository : options.repository) };
  const reviews = { create: vi.fn().mockResolvedValue({ id: "job-1" }), findByCorrelationId: vi.fn().mockResolvedValue(null) };
  const discord = { publishAzureDevOpsEvent: vi.fn().mockResolvedValue(false) };
  const service = new WebhooksService(prisma as any, credentials as any, repositories as any, reviews as any, discord as any);
  return { service, prisma, credentials, repositories, reviews, discord };
}

describe("WebhooksService", () => {
  it("rejects when the repository referenced by the webhook does not exist", async () => {
    const { service } = buildService({ repository: null });
    await expect(service.azureDevOps("repo-1", "token", buildBody())).rejects.toThrow(/Webhook repository not found/);
  });

  it("rejects when the webhook token does not match the repository secret", async () => {
    const { service } = buildService({ tokenMatches: false });
    await expect(service.azureDevOps("repo-1", "bad-token", buildBody())).rejects.toThrow(/Invalid webhook token/);
  });

  it("looks up the repository by id only, without an organization filter, before validating the token", async () => {
    const { service, repositories, credentials } = buildService();
    await service.azureDevOps("repo-1", "token", buildBody());
    expect(repositories.findByIdWithSettings).toHaveBeenCalledWith("repo-1");
    expect(credentials.matchesWebhookSecret).toHaveBeenCalledWith("token", "hash");
  });

  it("creates a review job for a new qualifying pull request event", async () => {
    const { service, reviews, prisma, discord } = buildService();
    const result = await service.azureDevOps("repo-1", "token", buildBody({ resource: { repository: { id: "azure-repo-1", project: { id: "azure-project-1" } }, pullRequestId: 42, reviewers: [{ displayName: "Maroli" }, { displayName: "Ana" }, { displayName: "Maroli" }] } }));
    expect(reviews.create).toHaveBeenCalledWith("org-1", { repositoryId: "repo-1", pullRequestId: "42" }, expect.any(String), "webhook");
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reviewJobId: "job-1" }) }));
    expect(result).toEqual({ accepted: true, jobId: "job-1" });
    expect(discord.publishAzureDevOpsEvent).toHaveBeenCalledWith("org-1", "repo-1", expect.objectContaining({ eventType: "git.pullrequest.created", repositoryName: "repo-1", pullRequestId: "42", reviewers: ["Maroli", "Ana"] }));
  });

  it("short-circuits as a duplicate when the event was already processed", async () => {
    const { service, reviews } = buildService({ storedEvent: { id: "stored-1", processedAt: new Date(), reviewJobId: "job-existing" } });
    const result = await service.azureDevOps("repo-1", "token", buildBody());
    expect(result).toEqual({ accepted: true, duplicate: true, jobId: "job-existing" });
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it("ignores events that are not a qualifying pull request event or when auto-review is disabled", async () => {
    const { service, reviews } = buildService({ repository: { ...baseRepository, settings: { autoReview: false } } });
    const result = await service.azureDevOps("repo-1", "token", buildBody());
    expect(result).toEqual({ accepted: true, ignored: true });
    expect(reviews.create).not.toHaveBeenCalled();
  });

  it("accepts non-pull-request Azure events so they can be forwarded to Discord", async () => {
    const { service, discord } = buildService();
    const result = await service.azureDevOps("repo-1", "token", buildBody({ eventType: "git.push", resource: { repository: { id: "azure-repo-1", project: { id: "azure-project-1" } } } }));
    expect(result).toEqual({ accepted: true, ignored: true });
    expect(discord.publishAzureDevOpsEvent).toHaveBeenCalledWith("org-1", "repo-1", expect.objectContaining({ eventType: "git.push" }));
  });

  it("keeps the event available for retry when Discord delivery fails", async () => {
    const { service, prisma, discord } = buildService();
    discord.publishAzureDevOpsEvent.mockRejectedValue(new Error("Discord unavailable"));
    await expect(service.azureDevOps("repo-1", "token", buildBody())).rejects.toThrow("Discord unavailable");
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: { processingAt: null } }));
  });

  it("rejects when the event's repository identity does not match the URL repository", async () => {
    const { service } = buildService();
    const body = buildBody({ resource: { repository: { id: "some-other-repo" }, pullRequestId: 42 } });
    await expect(service.azureDevOps("repo-1", "token", body)).rejects.toThrow(/does not match URL repository/);
  });

  it("uses Azure's concise event message instead of the pull request detail", async () => {
    const { service, discord } = buildService();
    await service.azureDevOps("repo-1", "token", buildBody({ message: { text: "Mayk changed the reviewer list" }, detailedMessage: { text: "Long pull request description" } }));
    expect(discord.publishAzureDevOpsEvent).toHaveBeenCalledWith("org-1", "repo-1", expect.objectContaining({ message: "Mayk changed the reviewer list" }));
  });

  it("forwards the author of a pull request comment", async () => {
    const { service, discord } = buildService();
    const body = buildBody({ eventType: "ms.vss-code.git-pullrequest-comment-event", resource: { comment: { author: { displayName: "Maroli" } }, pullRequest: { repository: { id: "azure-repo-1", project: { id: "azure-project-1" } }, pullRequestId: 42, title: "Fix dates", description: "Corrects the report dates" } } });
    const result = await service.azureDevOps("repo-1", "token", body);
    expect(result).toEqual({ accepted: true, ignored: true });
    expect(discord.publishAzureDevOpsEvent).toHaveBeenCalledWith("org-1", "repo-1", expect.objectContaining({ eventType: "ms.vss-code.git-pullrequest-comment-event", author: "Maroli", pullRequestId: "42", pullRequestDescription: "Corrects the report dates" }));
  });
});
