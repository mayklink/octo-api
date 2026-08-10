import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { ReviewsService } from "../src/modules/reviews/reviews.service";

function buildService(overrides: { prisma?: any; repositories?: any; organizations?: any } = {}) {
  const prisma = overrides.prisma ?? {};
  const repositories = overrides.repositories ?? {};
  const organizations = overrides.organizations ?? {};
  return new ReviewsService(prisma, repositories, {} as any, {} as any, {} as any, {} as any, organizations);
}

describe("ReviewsService model policy", () => {
  it("returns the organization's effective allowed models and default model", async () => {
    const organizations = { resolveModelPolicy: vi.fn().mockResolvedValue({ allowedModels: ["a", "b"], defaultModel: "b" }) };
    const service = buildService({ organizations });

    await expect(service.getAllowedModels("org-1")).resolves.toEqual({ models: ["a", "b"], defaultModel: "b" });
    expect(organizations.resolveModelPolicy).toHaveBeenCalledWith("org-1");
  });

  it("rejects updating settings with a model outside the organization's effective policy", async () => {
    const repositories = { get: vi.fn().mockResolvedValue({ id: "repo-1" }) };
    const organizations = { resolveModelPolicy: vi.fn().mockResolvedValue({ allowedModels: ["a"], defaultModel: "a" }) };
    const prisma = { reviewSetting: { update: vi.fn() } };
    const service = buildService({ prisma, repositories, organizations });

    await expect(service.updateSettings("org-1", "repo-1", { model: "not-allowed", prompt: "p", autoReview: true } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reviewSetting.update).not.toHaveBeenCalled();
  });

  it("updates settings when the model is within the organization's effective policy", async () => {
    const updated = { repositoryId: "repo-1", model: "a" };
    const repositories = { get: vi.fn().mockResolvedValue({ id: "repo-1" }) };
    const organizations = { resolveModelPolicy: vi.fn().mockResolvedValue({ allowedModels: ["a", "b"], defaultModel: "a" }) };
    const prisma = { reviewSetting: { update: vi.fn().mockResolvedValue(updated) } };
    const service = buildService({ prisma, repositories, organizations });

    await expect(service.updateSettings("org-1", "repo-1", { model: "a", prompt: "p", autoReview: true } as any)).resolves.toEqual(updated);
    expect(organizations.resolveModelPolicy).toHaveBeenCalledWith("org-1");
  });
});
