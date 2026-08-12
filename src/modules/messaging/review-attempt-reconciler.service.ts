import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PinoLogger } from "nestjs-pino";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

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
      const expired = await this.prisma.reviewJobAttempt.findMany({
        where: { status: { in: ["published", "running"] }, deadlineAt: { lt: new Date() } },
        take: 10,
      });
      for (const attempt of expired) {
        await this.prisma.$transaction([
          this.prisma.reviewJobAttempt.update({ where: { id: attempt.id }, data: { status: "timed_out", failureCode: "REVIEW_TIMEOUT", failureCategory: "timeout", failureMessage: "Review deadline elapsed", completedAt: new Date() } }),
          this.prisma.reviewJob.update({ where: { id: attempt.reviewJobId }, data: { status: "failed", completedAt: new Date() } }),
          this.prisma.reviewPublication.upsert({ where: { dedupKey: `${attempt.reviewJobId}:status` }, update: { status: "pending", lastError: null }, create: { dedupKey: `${attempt.reviewJobId}:status`, reviewJobId: attempt.reviewJobId, kind: "status" } }),
        ]).catch((error: unknown) => {
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
