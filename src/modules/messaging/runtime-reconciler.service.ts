import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PinoLogger } from "nestjs-pino";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { ReviewRequestedV2 } from "../contracts/review-contracts";
import { E2bRuntimeService } from "./e2b-runtime.service";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";

@Injectable()
export class RuntimeReconcilerService {
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxDispatcherService, private readonly runtime: E2bRuntimeService, private readonly logger: PinoLogger) { logger.setContext(RuntimeReconcilerService.name); }
  @Cron(CronExpression.EVERY_30_SECONDS)
  async reconcile(): Promise<void> {
    if (this.running) return; this.running = true;
    try {
      const missing = await this.prisma.reviewJobAttempt.findMany({ where: { status: "published", sandboxId: null, OR: [{ startedAt: null }, { startedAt: { lt: new Date(Date.now() - 2 * 60_000) } }] }, take: 5 });
      for (const attempt of missing) {
        const outbox = await this.prisma.messageOutbox.findUnique({ where: { eventId: attempt.eventId } });
        if (outbox) await this.outbox.startRuntime(outbox.payload as unknown as ReviewRequestedV2).catch((error) => this.logger.error({ err: error, eventId: attempt.eventId }, "Runtime reconciliation failed"));
      }
      const expired = await this.prisma.reviewJobAttempt.findMany({ where: { status: { in: ["published", "running"] }, deadlineAt: { lt: new Date() } }, take: 10 });
      for (const attempt of expired) {
        await this.runtime.stop(attempt.sandboxId ?? undefined);
        await this.prisma.$transaction([
          this.prisma.reviewJobAttempt.update({ where: { id: attempt.id }, data: { status: "timed_out", failureCode: "REVIEW_TIMEOUT", failureCategory: "timeout", failureMessage: "Review deadline elapsed", completedAt: new Date() } }),
          this.prisma.reviewJob.update({ where: { id: attempt.reviewJobId }, data: { status: "failed", completedAt: new Date() } }),
          this.prisma.reviewPublication.upsert({ where: { dedupKey: `${attempt.reviewJobId}:status` }, update: { status: "pending", lastError: null }, create: { dedupKey: `${attempt.reviewJobId}:status`, reviewJobId: attempt.reviewJobId, kind: "status" } }),
        ]).catch((error: unknown) => { if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error; });
      }
    } finally { this.running = false; }
  }
}
