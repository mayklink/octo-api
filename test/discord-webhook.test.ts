import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DiscordWebhookService, toDiscordPayload } from "../src/modules/discord/discord-webhook.service";

describe("DiscordWebhookService", () => {
  it("accepts only HTTPS Discord incoming webhook URLs", () => {
    const service = new DiscordWebhookService({} as never, {} as never);
    expect(service.normalizeWebhookUrl("https://discord.com/api/webhooks/1234567890/token-value")).toBe("https://discord.com/api/webhooks/1234567890/token-value");
    expect(() => service.normalizeWebhookUrl("https://example.com/api/webhooks/123/token")).toThrow(BadRequestException);
    expect(() => service.normalizeWebhookUrl("http://discord.com/api/webhooks/123/token")).toThrow(BadRequestException);
  });

  it("stores only a normalized Discord URL through the encrypted credentials service", async () => {
    const credentials = { store: vi.fn().mockResolvedValue(undefined) };
    const prisma = { $executeRaw: vi.fn().mockResolvedValue(0) };
    const service = new DiscordWebhookService(credentials as never, prisma as never);
    await service.configure("org-1", "repo-1", "https://discord.com/api/webhooks/1234567890/token-value");
    expect(prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(credentials.store).toHaveBeenCalledWith("org-1", "repo-1", "discord_webhook", { url: "https://discord.com/api/webhooks/1234567890/token-value" });
  });

  it("converts Azure DevOps data into a Discord-safe embed", () => {
    expect(toDiscordPayload({ eventType: "git.pullrequest.created", eventId: "evt-1", repositoryName: "api", projectName: "Octob", pullRequestId: "12", pullRequestTitle: "Add Discord", author: "May", message: "@everyone no mentions" })).toMatchObject({
      allowed_mentions: { parse: [] },
      embeds: [{ title: "git.pullrequest.created", description: "@everyone no mentions", fields: expect.arrayContaining([{ name: "Repositório", value: "api", inline: true }]) }],
    });
  });

  it("posts the converted payload to the configured Discord webhook", async () => {
    const credentials = { loadIfConfigured: vi.fn().mockResolvedValue({ url: "https://discord.com/api/webhooks/1234567890/token-value" }) };
    const service = new DiscordWebhookService(credentials as never, {} as never);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await expect(service.publishAzureDevOpsEvent("org-1", "repo-1", { eventType: "git.push", eventId: "evt-1", repositoryName: "api" })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://discord.com/api/webhooks/1234567890/token-value", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });

  it("includes pull request reviewers in the Discord embed", () => {
    const payload = toDiscordPayload({ eventType: "git.pullrequest.updated", eventId: "evt-1", repositoryName: "api", reviewers: ["Maroli", "Ana"] });
    expect(payload.embeds[0].fields).toContainEqual({ name: "Revisores", value: "Maroli\nAna", inline: false });
  });

  it("limits a pull request description to a compact summary", () => {
    const payload = toDiscordPayload({ eventType: "git.pullrequest.updated", eventId: "evt-1", repositoryName: "api", pullRequestId: "12", pullRequestTitle: "Fix dates", pullRequestDescription: "  Corrige\n as datas   do relatório.  " });
    expect(payload.embeds[0].fields).toContainEqual({ name: "Resumo", value: "Corrige as datas do relatório.", inline: false });
  });
});
