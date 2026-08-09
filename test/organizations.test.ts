import { describe, expect, it, vi } from "vitest";
import { OrganizationsService } from "../src/modules/organizations/organizations.service";

describe("OrganizationsService", () => {
  it("lists organizations for a user with their membership role", async () => {
    const prisma = {
      organizationMember: {
        findMany: vi.fn().mockResolvedValue([
          { role: "owner", organization: { id: "org-1", name: "Acme" } },
          { role: "member", organization: { id: "org-2", name: "Beta" } },
        ]),
      },
    };
    const service = new OrganizationsService(prisma as any);

    const result = await service.listForUser("user-1");

    expect(prisma.organizationMember.findMany).toHaveBeenCalledWith({ where: { userId: "user-1" }, include: { organization: true }, orderBy: { createdAt: "asc" } });
    expect(result).toEqual([{ id: "org-1", name: "Acme", role: "owner" }, { id: "org-2", name: "Beta", role: "member" }]);
  });

  it("returns an empty list when the user has no memberships", async () => {
    const prisma = { organizationMember: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new OrganizationsService(prisma as any);
    await expect(service.listForUser("user-without-org")).resolves.toEqual([]);
  });
});
