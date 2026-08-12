import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PinoLogger } from "nestjs-pino";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { ReviewRequestedV2 } from "../contracts/review-contracts";
import { RabbitConnection } from "./rabbit.connection";

@Injectable()
export class OutboxDispatcherService {
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly rabbit: RabbitConnection, private readonly logger: PinoLogger) { logger.setContext(OutboxDispatcherService.name); }
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
    await this.prisma.$transaction([
      this.prisma.reviewJobAttempt.update({ where: { eventId: event.eventId }, data: { status: "running", startedAt: new Date() } }),
      this.prisma.reviewJob.update({ where: { id: event.jobId }, data: { status: "running" } }),
    ]);
  }
}
