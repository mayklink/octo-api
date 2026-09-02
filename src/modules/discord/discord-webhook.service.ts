import { BadGatewayException, BadRequestException, Injectable } from "@nestjs/common";
import { CredentialKind, Prisma } from "@prisma/client";
import { CredentialsService } from "../credentials/credentials.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

export type AzureDevOpsDiscordEvent = {
  eventType: string;
  eventId: string;
  repositoryName: string;
  projectName?: string;
  pullRequestId?: string;
  pullRequestTitle?: string;
  pullRequestUrl?: string;
  author?: string;
  occurredAt?: string;
  message?: string;
};

@Injectable()
export class DiscordWebhookService {
  constructor(private readonly credentials: CredentialsService, private readonly prisma: PrismaService) {}

  normalizeWebhookUrl(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new BadRequestException("Discord webhook URL must be a valid URL"); }
    const validHost = url.hostname === "discord.com" || url.hostname === "discordapp.com";
    if (url.protocol !== "https:" || !validHost || !/^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname)) {
      throw new BadRequestException("Discord webhook URL must be an HTTPS Discord incoming webhook URL");
    }
    return url.toString();
  }

  async configure(organizationId: string, repositoryId: string, webhookUrl: string): Promise<void> {
    await this.ensureDiscordCredentialKind();
    await this.credentials.store(organizationId, repositoryId, CredentialKind.discord_webhook, { url: this.normalizeWebhookUrl(webhookUrl) });
  }

  async publishAzureDevOpsEvent(organizationId: string, repositoryId: string, event: AzureDevOpsDiscordEvent): Promise<boolean> {
    const configured = await this.credentials.loadIfConfigured(organizationId, repositoryId, CredentialKind.discord_webhook);
    if (!configured) return false;
    const url = discordWebhookUrl(configured);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toDiscordPayload(event)),
      });
    } catch (error) {
      throw new BadGatewayException("Discord webhook could not be reached", { cause: error as Error });
    }
    if (!response.ok) throw new BadGatewayException(`Discord webhook returned HTTP ${response.status}`);
    return true;
  }

  private ensureDiscordCredentialKind(): Promise<number> {
    return this.prisma.$executeRaw(Prisma.sql`ALTER TYPE "CredentialKind" ADD VALUE IF NOT EXISTS 'discord_webhook'`);
  }
}

function discordWebhookUrl(value: unknown): string {
  if (!isRecord(value) || typeof value.url !== "string") throw new BadGatewayException("Configured Discord webhook is invalid");
  return value.url;
}

export function toDiscordPayload(event: AzureDevOpsDiscordEvent) {
  const fields = [
    { name: "Repositório", value: event.repositoryName, inline: true },
    ...(event.projectName ? [{ name: "Projeto", value: event.projectName, inline: true }] : []),
    ...(event.pullRequestId ? [{ name: "Pull request", value: `#${event.pullRequestId}${event.pullRequestTitle ? ` — ${event.pullRequestTitle}` : ""}`, inline: false }] : []),
    ...(event.author ? [{ name: "Autor", value: event.author, inline: true }] : []),
  ].map((field) => ({ ...field, value: truncate(field.value, 1024) }));
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: truncate(event.eventType, 256),
      description: event.message ? truncate(event.message, 4096) : undefined,
      url: event.pullRequestUrl,
      timestamp: event.occurredAt,
      fields,
      footer: { text: `Azure DevOps · evento ${event.eventId}` },
    }],
  };
}

function truncate(value: string, length: number): string { return value.length <= length ? value : `${value.slice(0, length - 1)}…`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
