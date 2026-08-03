import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { Public } from "../auth/public.decorator";
import { RabbitConnection } from "../messaging/rabbit.connection";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly rabbit: RabbitConnection) {}

  @Public()
  @Get("live")
  live() { return { status: "ok", timestamp: new Date().toISOString() }; }

  @Public()
  @Get("ready")
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (!this.rabbit.isReady) throw new Error("RabbitMQ is not ready");
      return { status: "ready", checks: { database: "up", rabbitmq: "up" } };
    } catch (error) {
      throw new ServiceUnavailableException(error instanceof Error ? error.message : "Dependency unavailable");
    }
  }
}
