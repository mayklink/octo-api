import { describe, expect, it, vi } from "vitest";
import { OutboxDispatcherService } from "../src/modules/messaging/outbox-dispatcher.service";
import { ReviewAttemptReconcilerService } from "../src/modules/messaging/review-attempt-reconciler.service";
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

  it("expires every active attempt state, including retry_wait", async () => {
    const attempt = { id: "attempt-1", reviewJobId: "job-1", attempt: 2 };
    const transaction = {
      reviewJobAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      reviewJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      reviewPublication: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      reviewJobAttempt: { findMany: vi.fn().mockResolvedValue([attempt]) },
      $transaction: vi.fn(async (work: (tx: typeof transaction) => Promise<void>) => work(transaction)),
    };
    const service = new ReviewAttemptReconcilerService(prisma as never, { setContext: vi.fn(), error: vi.fn() } as never);

    await service.reconcile();

    expect(prisma.reviewJobAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["created", "published", "running", "retry_wait"] } }),
    }));
    expect(transaction.reviewJobAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "attempt-1", status: { in: ["created", "published", "running", "retry_wait"] } }),
      data: expect.objectContaining({ status: "timed_out", nextRetryAt: null }),
    }));
    expect(transaction.reviewJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "job-1", currentAttempt: 2 }),
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(transaction.reviewPublication.upsert).toHaveBeenCalledOnce();
  });

  it("does not fail a job when the expired attempt was claimed concurrently", async () => {
    const transaction = {
      reviewJobAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      reviewJob: { updateMany: vi.fn() },
      reviewPublication: { upsert: vi.fn() },
    };
    const prisma = {
      reviewJobAttempt: { findMany: vi.fn().mockResolvedValue([{ id: "attempt-1", reviewJobId: "job-1", attempt: 1 }]) },
      $transaction: vi.fn(async (work: (tx: typeof transaction) => Promise<void>) => work(transaction)),
    };
    const service = new ReviewAttemptReconcilerService(prisma as never, { setContext: vi.fn(), error: vi.fn() } as never);

    await service.reconcile();

    expect(transaction.reviewJob.updateMany).not.toHaveBeenCalled();
    expect(transaction.reviewPublication.upsert).not.toHaveBeenCalled();
  });
});
