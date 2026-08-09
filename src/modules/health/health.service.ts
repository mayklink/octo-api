import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { RabbitConnection } from "../messaging/rabbit.connection";

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService, private readonly rabbit: RabbitConnection) {}

  async checkReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (!this.rabbit.isReady) throw new Error("RabbitMQ is not ready");
      return { status: "ready", checks: { database: "up", rabbitmq: "up" } };
    } catch (error) {
      throw new ServiceUnavailableException(error instanceof Error ? error.message : "Dependency unavailable");
    }
  }
}
