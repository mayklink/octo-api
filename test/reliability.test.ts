import { describe, expect, it, vi } from "vitest";
import { OutboxDispatcherService } from "../src/modules/messaging/outbox-dispatcher.service";
import { PublicationService } from "../src/modules/reviews/publication.service";

describe("async claim recovery", () => {
  it("queries pending and expired processing outbox rows", async () => {
    const prisma = { messageOutbox: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new OutboxDispatcherService(prisma as never, { isReady: true } as never, { setContext: vi.fn() } as never);

    await service.dispatch();

    expect(prisma.messageOutbox.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [expect.objectContaining({ status: "pending" }), expect.objectContaining({ status: "processing" })] },
    }));
  });

  it("queries pending and expired publishing records", async () => {
    const prisma = { reviewPublication: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new PublicationService(prisma as never, {} as never, {} as never, { setContext: vi.fn() } as never);

    await service.publishPending();

    expect(prisma.reviewPublication.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { attempts: { lt: 5 }, OR: [{ status: "pending" }, expect.objectContaining({ status: "publishing" })] },
    }));
  });
});
