import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { ReviewCompletedV2, ReviewOutcomeV2 } from "../contracts/review-contracts";
import { CredentialsService } from "../credentials/credentials.service";

@Injectable()
export class ResultProcessorService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly credentials: CredentialsService) {}

  async process(routingKey: string, event: ReviewOutcomeV2): Promise<{ duplicate: boolean; sandboxId?: string }> {
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.messageInbox.findUnique({ where: { eventId: event.eventId } });
      if (prior?.status === "processed") return { duplicate: true };
      await tx.messageInbox.upsert({ where: { eventId: event.eventId }, update: {}, create: { eventId: event.eventId, routingKey, payload: event as unknown as Prisma.InputJsonValue } });
      const job = await tx.reviewJob.findUnique({ where: { id: event.jobId }, include: { repository: { include: { settings: true } }, pullRequest: true, attempts: { where: { attempt: event.attempt }, take: 1 } } });
      const attempt = job?.attempts[0];
      if (!job || !attempt || attempt.eventId !== event.causationId || job.correlationId !== event.correlationId) throw new Error("Outcome identity does not match a known review attempt");
      await this.credentials.persistCodexRefresh(event);
      if (["completed", "failed", "timed_out"].includes(attempt.status)) { await tx.messageInbox.update({ where: { eventId: event.eventId }, data: { status: "processed", processedAt: new Date() } }); return { duplicate: true, sandboxId: attempt.sandboxId ?? undefined }; }

      if (routingKey === "review.completed") await this.complete(tx, job, attempt.id, event as ReviewCompletedV2);
      else {
        const failure = (event as Exclude<ReviewOutcomeV2, ReviewCompletedV2>).failure;
        const maxAttempts = Math.min(job.repository.settings?.maxAttempts ?? 1, this.config.getOrThrow<number>("review.maxAttempts"));
        const retry = routingKey === "review.attempt_failed" && failure.retryable && event.attempt < maxAttempts;
        const nextRetryAt = retry ? new Date(Date.now() + this.config.getOrThrow<number>("review.retryBaseDelayMs") * 2 ** (event.attempt - 1)) : undefined;
        await tx.reviewJobAttempt.update({ where: { id: attempt.id }, data: { status: retry ? "retry_wait" : "failed", failureCode: failure.code, failureCategory: failure.category, failureMessage: failure.message, timings: event.timings as Prisma.InputJsonValue | undefined, completedAt: new Date((event as any).failedAt), nextRetryAt } });
        await tx.reviewJob.update({ where: { id: job.id }, data: { status: retry ? "retry_wait" : "failed", completedAt: retry ? null : new Date() } });
        if (!retry) await tx.reviewPublication.upsert({ where: { dedupKey: `${job.id}:status` }, update: { status: "pending", lastError: null }, create: { dedupKey: `${job.id}:status`, reviewJobId: job.id, kind: "status" } });
      }
      await tx.messageInbox.update({ where: { eventId: event.eventId }, data: { status: "processed", processedAt: new Date() } });
      return { duplicate: false, sandboxId: attempt.sandboxId ?? undefined };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    });
  }

  private async complete(tx: Prisma.TransactionClient, job: any, attemptId: string, event: ReviewCompletedV2): Promise<void> {
    if (event.organizationId !== job.organizationId || event.repositoryId !== job.repositoryId || event.pullRequestId !== job.pullRequest.providerPullRequestId || event.sourceCommit !== job.pullRequest.sourceCommit || event.targetCommit !== job.pullRequest.targetCommit) throw new Error("Completed outcome does not match persisted review context");
    await tx.reviewFinding.deleteMany({ where: { attemptId } });
    if (event.findings.length) await tx.reviewFinding.createMany({ data: event.findings.map((finding, ordinal) => ({ reviewJobId: job.id, attemptId, ordinal, ...finding })) });
    await tx.reviewJobAttempt.update({ where: { id: attemptId }, data: { status: "completed", timings: event.timings as unknown as Prisma.InputJsonValue, startedAt: new Date(event.startedAt), completedAt: new Date(event.completedAt) } });
    await tx.reviewJob.update({ where: { id: job.id }, data: { status: "completed", summary: { ...event.summary, engine: event.engine, policyVersion: event.policyVersion, tokenUsage: event.tokenUsage } as Prisma.InputJsonValue, completedAt: new Date(event.completedAt) } });
    const findings = await tx.reviewFinding.findMany({ where: { attemptId } });
    if (findings.length) await tx.reviewPublication.createMany({ data: findings.map((finding) => ({ dedupKey: `${job.id}:finding:${finding.id}`, reviewJobId: job.id, findingId: finding.id, kind: "finding" as const })), skipDuplicates: true });
    await tx.reviewPublication.upsert({ where: { dedupKey: `${job.id}:status` }, update: { status: "pending", lastError: null }, create: { dedupKey: `${job.id}:status`, reviewJobId: job.id, kind: "status" } });
  }
}
