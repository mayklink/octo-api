import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CredentialKind } from "@prisma/client";
import { PinoLogger } from "nestjs-pino";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AzureDevOpsAdapter } from "../azure-devops/azure-devops.adapter";
import { CredentialsService } from "../credentials/credentials.service";

@Injectable()
export class PublicationService {
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly azure: AzureDevOpsAdapter, private readonly credentials: CredentialsService, private readonly logger: PinoLogger) { logger.setContext(PublicationService.name); }
  @Cron(CronExpression.EVERY_5_SECONDS)
  async publishPending(): Promise<void> {
    if (this.running) return; this.running = true;
    try {
      const publications = await this.prisma.reviewPublication.findMany({ where: { status: "pending", attempts: { lt: 5 } }, take: 10, orderBy: { createdAt: "asc" }, include: { finding: true, reviewJob: { include: { repository: true, pullRequest: true } } } });
      for (const publication of publications) await this.publishOne(publication);
    } finally { this.running = false; }
  }
  private async publishOne(publication: any): Promise<void> {
    const claimed = await this.prisma.reviewPublication.updateMany({ where: { id: publication.id, status: "pending" }, data: { status: "publishing", attempts: { increment: 1 } } });
    if (!claimed.count) return;
    try {
      const { reviewJob: job } = publication;
      const pat = await this.credentials.load(job.organizationId, job.repositoryId, CredentialKind.azure_devops_pat) as string;
      let externalId: string | undefined;
      if (publication.kind === "finding" && publication.finding) externalId = await this.azure.publishFinding(job.repository, pat, job.pullRequest.providerPullRequestId, publication.finding);
      else {
        const succeeded = job.status === "completed";
        await this.azure.publishStatus(job.repository, pat, job.pullRequest.providerPullRequestId, succeeded ? "succeeded" : "failed", succeeded ? "Octob review completed" : "Octob review failed");
        externalId = await this.azure.publishSummary(job.repository, pat, job.pullRequest.providerPullRequestId, summaryComment(job.summary, succeeded));
      }
      await this.prisma.reviewPublication.update({ where: { id: publication.id }, data: { status: "completed", externalId, publishedAt: new Date(), lastError: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Publication failed";
      const terminal = publication.attempts + 1 >= 5;
      await this.prisma.reviewPublication.update({ where: { id: publication.id }, data: { status: terminal ? "failed" : "pending", lastError: message } });
      this.logger.warn({ err: error, publicationId: publication.id }, "Azure publication failed");
    }
  }
}

function summaryComment(summary: unknown, succeeded: boolean): string {
  if (isRecord(summary) && typeof summary.markdown === "string" && summary.markdown.trim()) return summary.markdown;
  return succeeded ? "## Octob review completed" : "## Octob review failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
