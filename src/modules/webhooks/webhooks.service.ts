import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { createHash } from "node:crypto";
import { CredentialsService } from "../credentials/credentials.service";
import { RepositoriesService } from "../repositories/repositories.service";
import { ReviewsService } from "../reviews/reviews.service";

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService, private readonly credentials: CredentialsService, private readonly repositories: RepositoriesService, private readonly reviews: ReviewsService) {}
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
    if (!["git.pullrequest.created", "git.pullrequest.updated"].includes(event.type) || !repository.settings?.autoReview) {
      await this.prisma.webhookEvent.update({ where: { id: stored.id }, data: { processedAt: new Date(), processingAt: null } });
      return { accepted: true, ignored: true };
    }
    const correlationId = event.correlationId?.slice(0, 128) || `wh-${createHash("sha256").update(`${repositoryId}:${event.id}`).digest("hex")}`;
    try {
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
  if (typeof pr !== "number" && typeof pr !== "string") throw new UnprocessableEntityException("Webhook pull request identity is missing");
  return { id: value.id.slice(0, 256), type: value.eventType, azureRepositoryId: repository.id, projectId: typeof project?.id === "string" ? project.id : undefined, pullRequestId: String(pr), correlationId: typeof value.correlationId === "string" ? value.correlationId : undefined };
}
function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
