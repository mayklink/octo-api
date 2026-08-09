import { describe, expect, it, vi } from "vitest";
import { HealthService } from "../src/modules/health/health.service";

function buildService(overrides: { queryRaw?: () => Promise<unknown>; rabbitReady?: boolean } = {}) {
  const prisma = { $queryRaw: vi.fn(overrides.queryRaw ?? (async () => [{ ok: 1 }])) };
  const rabbit = { isReady: overrides.rabbitReady ?? true };
  return { service: new HealthService(prisma as any, rabbit as any), prisma, rabbit };
}

describe("HealthService", () => {
  it("reports database and rabbitmq as up when both dependencies respond", async () => {
    const { service, prisma } = buildService();
    await expect(service.checkReadiness()).resolves.toEqual({ status: "ready", checks: { database: "up", rabbitmq: "up" } });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("fails readiness when the database query rejects", async () => {
    const { service } = buildService({ queryRaw: async () => { throw new Error("connection refused"); } });
    await expect(service.checkReadiness()).rejects.toThrow(/connection refused/);
  });

  it("fails readiness when RabbitMQ is not ready", async () => {
    const { service } = buildService({ rabbitReady: false });
    await expect(service.checkReadiness()).rejects.toThrow(/RabbitMQ is not ready/);
  });
});
