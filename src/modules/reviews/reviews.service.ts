import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CredentialKind, JobSource, Prisma, RepositoryStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AzureDevOpsAdapter } from "../azure-devops/azure-devops.adapter";
import type { AzurePullRequest } from "../azure-devops/azure-devops.types";
import { ContractsService } from "../contracts/contracts.service";
import type { EncryptedCredential, ReviewRequestedV2 } from "../contracts/review-contracts";
import { CredentialsService } from "../credentials/credentials.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { RepositoriesService } from "../repositories/repositories.service";
import type { CreateReviewJobDto, UpdateReviewSettingsDto } from "./reviews.dto";

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService, private readonly repositories: RepositoriesService, private readonly credentials: CredentialsService, private readonly azure: AzureDevOpsAdapter, private readonly contracts: ContractsService, private readonly config: ConfigService, private readonly organizations: OrganizationsService) {}

  async create(organizationId: string, dto: CreateReviewJobDto, correlationId: string, source: JobSource = "manual") {
    if (source === "manual") correlationId = randomUUID();
    const repository = await this.repositories.get(organizationId, dto.repositoryId);
    if (repository.status !== RepositoryStatus.active) throw new ConflictException("Repository integration is not active");
    const [pat, authJson, settings] = await Promise.all([
      this.credentials.load(organizationId, repository.id, CredentialKind.azure_devops_pat) as Promise<string>,
      this.credentials.load(organizationId, null, CredentialKind.codex_auth),
      this.prisma.reviewSetting.findUnique({ where: { repositoryId: repository.id } }),
    ]);
    if (!settings) throw new NotFoundException("Review settings not found");
    await this.assertModel(organizationId, settings.model);
    const [pullRequest, context] = await Promise.all([this.azure.getPullRequest(repository, pat, dto.pullRequestId), this.azure.getReviewContext(repository, pat, dto.pullRequestId)]);
    const jobId = randomUUID(); const eventId = randomUUID(); const attempt = 1;
    const request = this.buildRequest({ jobId, eventId, attempt, correlationId, organizationId, repository, pullRequest, context, settings, pat, authJson });
    this.contracts.assertRequest(request);
    const deadlineAt = new Date(request.deadlineAt);
    const job = await this.prisma.$transaction(async (tx) => {
      const pr = await tx.pullRequest.upsert({ where: { repositoryId_providerPullRequestId: { repositoryId: repository.id, providerPullRequestId: pullRequest.id } }, update: { title: pullRequest.title, status: pullRequest.status, sourceBranch: pullRequest.sourceBranch, targetBranch: pullRequest.targetBranch, sourceCommit: pullRequest.sourceCommit, targetCommit: pullRequest.targetCommit, raw: pullRequest.raw as Prisma.InputJsonValue }, create: { repositoryId: repository.id, providerPullRequestId: pullRequest.id, title: pullRequest.title, status: pullRequest.status, sourceBranch: pullRequest.sourceBranch, targetBranch: pullRequest.targetBranch, sourceCommit: pullRequest.sourceCommit, targetCommit: pullRequest.targetCommit, raw: pullRequest.raw as Prisma.InputJsonValue } });
      const created = await tx.reviewJob.create({ data: { id: jobId, organizationId, repositoryId: repository.id, pullRequestId: pr.id, source, status: "created", correlationId, attempts: { create: { attempt, eventId, deadlineAt } } } });
      await tx.messageOutbox.create({ data: { eventId, aggregateId: jobId, routingKey: "review.requested", payload: request as unknown as Prisma.InputJsonValue } });
      return created;
    });
    return this.get(organizationId, job.id);
  }

  async retry(organizationId: string, jobId: string) {
    const job = await this.prisma.reviewJob.findFirst({ where: { id: jobId, organizationId }, include: { pullRequest: true, attempts: { orderBy: { attempt: "desc" }, take: 1 }, repository: { include: { settings: true } } } });
    if (!job) throw new NotFoundException("Review job not found");
    if (["created", "queued", "running"].includes(job.status)) throw new ConflictException("Review job is already active");
    return this.createRetryAttempt(job);
  }

  async createRetryAttempt(job: Awaited<ReturnType<ReviewsService["loadRetryJob"]>>) {
    if (!job?.repository.settings) throw new NotFoundException("Review job settings not found");
    const maxAttempts = Math.min(job.repository.settings.maxAttempts, this.config.getOrThrow<number>("review.maxAttempts"));
    const attempt = job.currentAttempt + 1;
    if (attempt > maxAttempts) throw new BadRequestException("Maximum review attempts reached");
    const previousAttemptId = job.attempts[0]?.id;
    const [pat, authJson, context] = await Promise.all([
      this.credentials.load(job.organizationId, job.repositoryId, CredentialKind.azure_devops_pat) as Promise<string>,
      this.credentials.load(job.organizationId, null, CredentialKind.codex_auth),
      this.azure.getReviewContext(job.repository, await this.credentials.load(job.organizationId, job.repositoryId, CredentialKind.azure_devops_pat) as string, job.pullRequest.providerPullRequestId),
    ]);
    const eventId = randomUUID();
    const pullRequest: AzurePullRequest = { id: job.pullRequest.providerPullRequestId, title: job.pullRequest.title, status: job.pullRequest.status, sourceBranch: job.pullRequest.sourceBranch, targetBranch: job.pullRequest.targetBranch, sourceCommit: job.pullRequest.sourceCommit, targetCommit: job.pullRequest.targetCommit, raw: (job.pullRequest.raw ?? {}) as Record<string, unknown> };
    const request = this.buildRequest({ jobId: job.id, eventId, attempt, correlationId: job.correlationId, organizationId: job.organizationId, repository: job.repository, pullRequest, context, settings: job.repository.settings, pat, authJson });
    this.contracts.assertRequest(request);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.reviewJob.updateMany({
        where: { id: job.id, currentAttempt: job.currentAttempt, status: { in: ["retry_wait", "failed", "completed"] } },
        data: { currentAttempt: attempt, status: "created" },
      });
      if (!claimed.count) throw new ConflictException("Review retry is already being processed");

      if (previousAttemptId) {
        await tx.reviewJobAttempt.updateMany({ where: { id: previousAttemptId, status: "retry_wait" }, data: { status: "failed", nextRetryAt: null } });
      }
      await tx.reviewJobAttempt.create({ data: { reviewJobId: job.id, attempt, eventId, deadlineAt: new Date(request.deadlineAt) } });
      await tx.messageOutbox.create({ data: { eventId, aggregateId: job.id, routingKey: "review.requested", payload: request as unknown as Prisma.InputJsonValue } });
    });
    return this.get(job.organizationId, job.id);
  }

  list(organizationId: string, take = 25) { return this.prisma.reviewJob.findMany({ where: { organizationId }, take: Math.min(take, 100), orderBy: { createdAt: "desc" }, include: { repository: { select: { id: true, name: true } }, pullRequest: { select: { providerPullRequestId: true, title: true } } } }); }
  async get(organizationId: string, id: string) { const job = await this.prisma.reviewJob.findFirst({ where: { id, organizationId }, include: { repository: { select: { id: true, name: true } }, pullRequest: true, attempts: { orderBy: { attempt: "desc" } } } }); if (!job) throw new NotFoundException("Review job not found"); return job; }
  async findings(organizationId: string, id: string) { await this.get(organizationId, id); return this.prisma.reviewFinding.findMany({ where: { reviewJobId: id }, orderBy: [{ severity: "desc" }, { ordinal: "asc" }] }); }
  async getSettings(organizationId: string, repositoryId: string) { await this.repositories.get(organizationId, repositoryId); return this.prisma.reviewSetting.findUniqueOrThrow({ where: { repositoryId } }); }
  async getAllowedModels(organizationId: string) { const { allowedModels, defaultModel } = await this.organizations.resolveModelPolicy(organizationId); return { models: allowedModels, defaultModel }; }
  async updateSettings(organizationId: string, repositoryId: string, dto: UpdateReviewSettingsDto) { await this.repositories.get(organizationId, repositoryId); await this.assertModel(organizationId, dto.model); return this.prisma.reviewSetting.update({ where: { repositoryId }, data: dto }); }
  loadRetryJob(jobId: string) { return this.prisma.reviewJob.findUnique({ where: { id: jobId }, include: { pullRequest: true, attempts: { orderBy: { attempt: "desc" }, take: 1 }, repository: { include: { settings: true } } } }); }
  findByCorrelationId(correlationId: string) { return this.prisma.reviewJob.findUnique({ where: { correlationId } }); }

  private buildRequest(args: any): ReviewRequestedV2 {
    const createdAt = new Date(); const deadlineAt = new Date(createdAt.getTime() + this.config.getOrThrow<number>("review.timeoutMs"));
    const empty: EncryptedCredential = { algorithm: "A256GCM", keyId: "local", iv: "AAAAAAAAAAAAAAAA", ciphertext: "x", authTag: "AAAAAAAAAAAAAAAAAAAAAA==" };
    const request: ReviewRequestedV2 = { schemaVersion: 2, eventId: args.eventId, jobId: args.jobId, attempt: args.attempt, correlationId: args.correlationId, organizationId: args.organizationId, repositoryId: args.repository.id, provider: "azure-devops", pullRequestId: args.pullRequest.id, sourceCommit: args.pullRequest.sourceCommit, targetCommit: args.pullRequest.targetCommit, sourceBranch: args.pullRequest.sourceBranch, targetBranch: args.pullRequest.targetBranch, clone: { url: args.repository.cloneUrl }, sourceControl: { encryptedCredential: empty }, context: { sections: buildContextSections(args.context) }, engine: { kind: "codex", model: args.settings.model, encryptedCredential: empty }, settings: { prompt: args.settings.prompt, ...(args.settings.severityThreshold ? { severityThreshold: args.settings.severityThreshold } : {}) }, createdAt: createdAt.toISOString(), deadlineAt: deadlineAt.toISOString() };
    request.sourceControl.encryptedCredential = this.credentials.createWorkerEnvelope(request, "source-control", { git: { username: "octob", password: args.pat } });
    request.engine.encryptedCredential = this.credentials.createWorkerEnvelope(request, "engine", args.authJson);
    return request;
  }
  private async assertModel(organizationId: string, model: string) { const { allowedModels } = await this.organizations.resolveModelPolicy(organizationId); if (!allowedModels.includes(model)) throw new BadRequestException("Review model is not allowed"); }
}

function buildContextSections(context: { pullRequest: unknown; workItems: unknown[]; threads: unknown[] }): ReviewRequestedV2["context"]["sections"] {
  const pullRequest = isRecord(context.pullRequest) ? context.pullRequest : {};
  const sections = [{ title: "Azure DevOps pull request", content: serializeContext(pullRequest) }];
  if (typeof pullRequest.description === "string" && pullRequest.description.trim()) {
    sections.push({ title: "Azure DevOps pull request description", content: truncateContext(pullRequest.description) });
  }
  if (context.workItems.length) sections.push({ title: "Azure DevOps linked work items", content: serializeContext(context.workItems.map(summarizeWorkItem)) });
  if (context.threads.length) sections.push({ title: "Azure DevOps pull request discussions", content: serializeContext(context.threads) });
  return sections;
}

function summarizeWorkItem(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const fields = isRecord(value.fields) ? value.fields : {};
  return {
    id: value.id,
    type: fields["System.WorkItemType"],
    title: fields["System.Title"],
    state: fields["System.State"],
    description: fields["System.Description"],
    acceptanceCriteria: fields["Microsoft.VSTS.Common.AcceptanceCriteria"],
    tags: fields["System.Tags"],
    url: value.url,
  };
}

function serializeContext(value: unknown): string { return truncateContext(JSON.stringify(value)); }
function truncateContext(value: string): string { return value.length <= 50_000 ? value : `${value.slice(0, 49_970)}\n[context truncated]`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
