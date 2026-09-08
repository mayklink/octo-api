import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PinoLogger } from "nestjs-pino";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

const ACTIVE_ATTEMPT_STATUSES = ["created", "published", "running", "retry_wait"] as const;
const ACTIVE_JOB_STATUSES = ["created", "queued", "running", "retry_wait"] as const;

@Injectable()
export class ReviewAttemptReconcilerService {
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly logger: PinoLogger) {
    logger.setContext(ReviewAttemptReconcilerService.name);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const expired = await this.prisma.reviewJobAttempt.findMany({
        where: { status: { in: [...ACTIVE_ATTEMPT_STATUSES] }, deadlineAt: { lt: now } },
        take: 10,
      });
      for (const attempt of expired) {
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.reviewJobAttempt.updateMany({
            where: { id: attempt.id, status: { in: [...ACTIVE_ATTEMPT_STATUSES] }, deadlineAt: { lt: now } },
            data: { status: "timed_out", failureCode: "REVIEW_TIMEOUT", failureCategory: "timeout", failureMessage: "Review deadline elapsed", nextRetryAt: null, completedAt: now },
          });
          if (!claimed.count) return;

          const completed = await tx.reviewJob.updateMany({
            where: { id: attempt.reviewJobId, currentAttempt: attempt.attempt, status: { in: [...ACTIVE_JOB_STATUSES] } },
            data: { status: "failed", completedAt: now },
          });
          if (!completed.count) return;

          await tx.reviewPublication.upsert({
            where: { dedupKey: `${attempt.reviewJobId}:status` },
            update: { status: "pending", lastError: null },
            create: { dedupKey: `${attempt.reviewJobId}:status`, reviewJobId: attempt.reviewJobId, kind: "status" },
          });
        }).catch((error: unknown) => {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        });
      }
    } catch (error) {
      this.logger.error({ err: error }, "Review attempt reconciliation failed");
    } finally {
      this.running = false;
    }
  }
}
