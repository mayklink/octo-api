import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PinoLogger } from "nestjs-pino";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { ReviewRequestedV2 } from "../contracts/review-contracts";
import { E2bRuntimeService } from "./e2b-runtime.service";
import { RabbitConnection } from "./rabbit.connection";

@Injectable()
export class OutboxDispatcherService {
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly rabbit: RabbitConnection, private readonly runtime: E2bRuntimeService, private readonly logger: PinoLogger) { logger.setContext(OutboxDispatcherService.name); }
  @Cron(CronExpression.EVERY_SECOND)
  async dispatch(): Promise<void> {
    if (this.running || !this.rabbit.isReady) return; this.running = true;
    try {
      const rows = await this.prisma.messageOutbox.findMany({ where: { status: "pending", availableAt: { lte: new Date() }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, take: 5, orderBy: { createdAt: "asc" } });
      for (const row of rows) await this.dispatchOne(row.id);
    } finally { this.running = false; }
  }
  private async dispatchOne(id: string): Promise<void> {
    const leaseUntil = new Date(Date.now() + 60_000);
    const claimed = await this.prisma.messageOutbox.updateMany({ where: { id, status: "pending", OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { status: "processing", leaseUntil, attempts: { increment: 1 } } });
    if (!claimed.count) return;
    const row = await this.prisma.messageOutbox.findUniqueOrThrow({ where: { id } }); const event = row.payload as unknown as ReviewRequestedV2;
    try { await this.rabbit.publish(event); }
    catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Outbox dispatch failed";
      await this.prisma.messageOutbox.update({ where: { id }, data: { status: "pending", availableAt: new Date(Date.now() + 10_000), leaseUntil: null, lastError: message } });
      this.logger.error({ err: error, eventId: event.eventId }, "Could not publish review request");
      return;
    }
    await this.prisma.$transaction([
        this.prisma.messageOutbox.update({ where: { id }, data: { status: "processed", publishedAt: new Date(), leaseUntil: null, lastError: null } }),
        this.prisma.reviewJobAttempt.update({ where: { eventId: event.eventId }, data: { status: "published" } }),
        this.prisma.reviewJob.update({ where: { id: event.jobId }, data: { status: "queued" } }),
    ]);
    await this.startRuntime(event).catch((error) => this.logger.error({ err: error, eventId: event.eventId }, "Review request was published but E2B runtime did not start; reconciler will retry"));
  }
  async startRuntime(event: ReviewRequestedV2): Promise<void> {
    const attempt = await this.prisma.reviewJobAttempt.findUnique({ where: { eventId: event.eventId } });
    if (!attempt || attempt.sandboxId || attempt.status !== "published") return;
    const claimed = await this.prisma.reviewJobAttempt.updateMany({ where: { id: attempt.id, status: "published", sandboxId: null, OR: [{ startedAt: null }, { startedAt: { lt: new Date(Date.now() - 2 * 60_000) } }] }, data: { startedAt: new Date() } });
    if (!claimed.count) return;
    const sandboxId = await this.runtime.start({ eventId: event.eventId, jobId: event.jobId, correlationId: event.correlationId });
    const updated = await this.prisma.reviewJobAttempt.updateMany({ where: { id: attempt.id, status: "published" }, data: { sandboxId, status: "running" } });
    if (!updated.count) { await this.runtime.stop(sandboxId); return; }
    await this.prisma.reviewJob.updateMany({ where: { id: event.jobId, status: "queued" }, data: { status: "running" } });
  }
}
