import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { createHash } from "node:crypto";
import { CredentialsService } from "../credentials/credentials.service";
import { RepositoriesService } from "../repositories/repositories.service";
import { ReviewsService } from "../reviews/reviews.service";
import { DiscordWebhookService } from "../discord/discord-webhook.service";

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService, private readonly credentials: CredentialsService, private readonly repositories: RepositoriesService, private readonly reviews: ReviewsService, private readonly discord: DiscordWebhookService) {}
  async azureDevOps(repositoryId: string, token: string, body: unknown) {
    const repository = await this.repositories.findByIdWithSettings(repositoryId);
    if (!repository) throw new NotFoundException("Webhook repository not found");
    if (!repository.webhookSecretHash || !this.credentials.matchesWebhookSecret(token, repository.webhookSecretHash)) throw new ForbiddenException("Invalid webhook token");
    const event = parseAzureEvent(body);
    if (event.azureRepositoryId.toLowerCase() !== repository.azureRepositoryId.toLowerCase()) throw new ForbiddenException("Webhook repository does not match URL repository");
    if (event.projectId && event.projectId.toLowerCase() !== repository.azureProjectId.toLowerCase()) throw new ForbiddenException("Webhook project does not match repository project");
    let stored = await this.prisma.webhookEvent.findUnique({ where: { repositoryId_providerEventId: { repositoryId, providerEventId: event.id } } });
    if (!stored) {
      try { stored = await this.prisma.webhookEvent.create({ data: { repositoryId, providerEventId: event.id, eventType: event.type, payload: body as Prisma.InputJsonValue } }); }
      catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error; stored = await this.prisma.webhookEvent.findUnique({ where: { repositoryId_providerEventId: { repositoryId, providerEventId: event.id } } }); }
    }
    if (!stored) throw new Error("Webhook event could not be persisted");
    if (stored.processedAt) return { accepted: true, duplicate: true, jobId: stored.reviewJobId };
    const claimed = await this.prisma.webhookEvent.updateMany({ where: { id: stored.id, processedAt: null, OR: [{ processingAt: null }, { processingAt: { lt: new Date(Date.now() - 2 * 60_000) } }] }, data: { processingAt: new Date() } });
    if (!claimed.count) return { accepted: true, duplicate: true, processing: true };
    try {
      await this.discord.publishAzureDevOpsEvent(repository.organizationId, repositoryId, {
        eventType: event.type, eventId: event.id, repositoryName: event.repositoryName ?? repository.name,
        projectName: event.projectName, pullRequestId: event.pullRequestId, pullRequestTitle: event.pullRequestTitle,
        pullRequestUrl: event.pullRequestUrl, author: event.author, occurredAt: event.occurredAt, message: event.message,
      });
      if (!["git.pullrequest.created", "git.pullrequest.updated"].includes(event.type) || !repository.settings?.autoReview || !event.pullRequestId) {
        await this.prisma.webhookEvent.update({ where: { id: stored.id }, data: { processedAt: new Date(), processingAt: null } });
        return { accepted: true, ignored: true };
      }
      const correlationId = event.correlationId?.slice(0, 128) || `wh-${createHash("sha256").update(`${repositoryId}:${event.id}`).digest("hex")}`;
      const existingJob = await this.reviews.findByCorrelationId(correlationId);
      const job = existingJob ?? await this.reviews.create(repository.organizationId, { repositoryId, pullRequestId: event.pullRequestId }, correlationId, "webhook");
      await this.prisma.webhookEvent.update({ where: { id: stored.id }, data: { reviewJobId: job.id, processedAt: new Date(), processingAt: null } });
      return { accepted: true, jobId: job.id };
    } catch (error) {
      await this.prisma.webhookEvent.update({ where: { id: stored.id }, data: { processingAt: null } }).catch(() => undefined);
      throw error;
    }
  }
}

function parseAzureEvent(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.eventType !== "string" || !isRecord(value.resource)) throw new UnprocessableEntityException("Invalid Azure DevOps webhook payload");
  const repository = isRecord(value.resource.repository) ? value.resource.repository : undefined;
  if (!repository || typeof repository.id !== "string") throw new UnprocessableEntityException("Webhook repository identity is missing");
  const project = isRecord(repository.project) ? repository.project : undefined;
  const pr = value.resource.pullRequestId;
  const createdBy = isRecord(value.resource.createdBy) ? value.resource.createdBy : undefined;
  return {
    id: value.id.slice(0, 256), type: value.eventType, azureRepositoryId: repository.id,
    projectId: typeof project?.id === "string" ? project.id : undefined,
    repositoryName: typeof repository.name === "string" ? repository.name : undefined,
    projectName: typeof project?.name === "string" ? project.name : undefined,
    pullRequestId: typeof pr === "number" || typeof pr === "string" ? String(pr) : undefined,
    pullRequestTitle: typeof value.resource.title === "string" ? value.resource.title : undefined,
    pullRequestUrl: typeof value.resource.url === "string" ? value.resource.url : undefined,
    author: typeof createdBy?.displayName === "string" ? createdBy.displayName : undefined,
    occurredAt: typeof value.createdDate === "string" ? value.createdDate : undefined,
    message: azureMessage(value), correlationId: typeof value.correlationId === "string" ? value.correlationId : undefined,
  };
}
function azureMessage(value: Record<string, unknown>): string | undefined {
  for (const key of ["detailedMessage", "message"]) {
    const message = value[key];
    if (isRecord(message) && typeof message.text === "string") return message.text;
  }
  return undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
