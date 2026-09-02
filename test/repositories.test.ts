import { describe, expect, it, vi } from "vitest";
import { RepositoriesService } from "../src/modules/repositories/repositories.service";

describe("RepositoriesService model policy seeding", () => {
  it("seeds the new repository's review settings with the organization's effective default model", async () => {
    const created = { id: "repo-1", organizationId: "org-1" };
    const prisma = { repository: { create: vi.fn().mockResolvedValue(created) } };
    const organizations = { resolveModelPolicy: vi.fn().mockResolvedValue({ allowedModels: ["a", "b"], defaultModel: "b" }) };
    const service = new RepositoriesService(prisma as any, {} as any, {} as any, {} as any, organizations as any, {} as any);

    await expect(service.create("org-1", { name: "repo", azureOrganization: "azo", azureProjectId: "proj", azureRepositoryId: "repoid", cloneUrl: "https://example.com" } as any)).resolves.toEqual(created);

    expect(organizations.resolveModelPolicy).toHaveBeenCalledWith("org-1");
    const data = prisma.repository.create.mock.calls[0][0].data;
    expect(data.settings.create.model).toBe("b");
  });
});
