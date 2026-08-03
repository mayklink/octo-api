import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PinoLogger } from "nestjs-pino";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { ReviewsService } from "./reviews.service";

@Injectable()
export class RetryScheduler {
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly reviews: ReviewsService, private readonly logger: PinoLogger) { logger.setContext(RetryScheduler.name); }
  @Cron(CronExpression.EVERY_10_SECONDS)
  async dispatch(): Promise<void> {
    if (this.running) return; this.running = true;
    try {
      const attempts = await this.prisma.reviewJobAttempt.findMany({ where: { status: "retry_wait", nextRetryAt: { lte: new Date() } }, take: 10, orderBy: { nextRetryAt: "asc" }, select: { reviewJobId: true } });
      for (const value of attempts) {
        try { const job = await this.reviews.loadRetryJob(value.reviewJobId); if (job?.status === "retry_wait") await this.reviews.createRetryAttempt(job); }
        catch (error) { this.logger.error({ err: error, jobId: value.reviewJobId }, "Could not create retry attempt"); }
      }
    } finally { this.running = false; }
  }
}
