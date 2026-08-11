import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { OrganizationsController } from "../src/modules/organizations/organizations.controller";
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
    const service = new OrganizationsService(prisma as any, {} as any);

    const result = await service.listForUser("user-1");

    expect(prisma.organizationMember.findMany).toHaveBeenCalledWith({ where: { userId: "user-1" }, include: { organization: true }, orderBy: { createdAt: "asc" } });
    expect(result).toEqual([{ id: "org-1", name: "Acme", role: "owner" }, { id: "org-2", name: "Beta", role: "member" }]);
  });

  it("returns an empty list when the user has no memberships", async () => {
    const prisma = { organizationMember: { findMany: vi.fn().mockResolvedValue([]) } };
    const service = new OrganizationsService(prisma as any, {} as any);
    await expect(service.listForUser("user-without-org")).resolves.toEqual([]);
  });

  it("invites a normalized email and stores a seven-day pending invite", async () => {
    const created = { id: "invite-1", email: "person@example.com", role: "admin", status: "pending" };
    const prisma = {
      organizationInvite: { create: vi.fn().mockResolvedValue(created) },
    };
    const supabaseAdmin = { inviteUserByEmail: vi.fn().mockResolvedValue({ id: "user-2" }) };
    const service = new OrganizationsService(prisma as any, {} as any, supabaseAdmin as any);
    const before = Date.now();

    await expect(service.inviteMember("org-1", "owner-1", " Person@Example.com ", "admin")).resolves.toEqual(created);

    expect(supabaseAdmin.inviteUserByEmail).toHaveBeenCalledWith("person@example.com");
    const data = prisma.organizationInvite.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ organizationId: "org-1", invitedByUserId: "owner-1", email: "person@example.com", role: "admin", status: "pending" });
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000 - 1000);
  });

  it("lists only pending invites after expiring overdue ones", async () => {
    const prisma = {
      organizationInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([{ id: "invite-1", status: "pending" }]),
      },
    };
    const service = new OrganizationsService(prisma as any, {} as any);

    await expect(service.listInvites("org-1")).resolves.toEqual([{ id: "invite-1", status: "pending" }]);
    expect(prisma.organizationInvite.findMany).toHaveBeenCalledWith({ where: { organizationId: "org-1", status: "pending" }, orderBy: { createdAt: "desc" } });
  });

  it("revokes a pending invite and rejects missing or already-closed invites", async () => {
    const prisma = { organizationInvite: { updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) } };
    const service = new OrganizationsService(prisma as any, {} as any);

    await expect(service.revokeInvite("org-1", "invite-1")).resolves.toEqual({ revoked: true });
    await expect(service.revokeInvite("org-1", "invite-2")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("allows member/admin role changes but never changes an owner", async () => {
    const prisma = {
      organizationMember: {
        findUnique: vi.fn().mockResolvedValueOnce({ role: "member" }).mockResolvedValueOnce({ role: "owner" }),
        update: vi.fn().mockResolvedValue({ organizationId: "org-1", userId: "user-2", role: "admin" }),
      },
    };
    const service = new OrganizationsService(prisma as any, {} as any);

    await expect(service.updateMemberRole("org-1", "user-2", "admin")).resolves.toMatchObject({ role: "admin" });
    await expect(service.updateMemberRole("org-1", "owner-1", "member")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("removes a member but protects the only owner", async () => {
    const prisma = {
      organizationMember: {
        findUnique: vi.fn().mockResolvedValueOnce({ role: "member" }).mockResolvedValueOnce({ role: "owner" }),
        delete: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(1),
      },
    };
    const service = new OrganizationsService(prisma as any, {} as any);

    await expect(service.removeMember("org-1", "user-2", "owner-1")).resolves.toEqual({ removed: true });
    await expect(service.removeMember("org-1", "owner-1", "owner-1")).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.organizationMember.delete).toHaveBeenCalledTimes(1);
  });

  it("accepts valid invites, expires overdue ones, and stays idempotent", async () => {
    const invite = { id: "invite-1", organizationId: "org-1", role: "member" };
    const prisma = {
      organizationInvite: {
        findMany: vi.fn().mockResolvedValueOnce([{ id: "expired-1" }]).mockResolvedValueOnce([invite]).mockResolvedValueOnce([]).mockResolvedValueOnce([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      organizationMember: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ organizationId: "org-1", userId: "user-2" }),
        create: vi.fn().mockResolvedValue({}),
      },
    };
    const service = new OrganizationsService(prisma as any, {} as any);

    await expect(service.acceptPendingInvitesForEmail(" Person@Example.com ", "user-2")).resolves.toEqual(["org-1"]);
    await expect(service.acceptPendingInvitesForEmail("person@example.com", "user-2")).resolves.toEqual([]);
    expect(prisma.organizationMember.create).toHaveBeenCalledTimes(1);
    expect(prisma.organizationInvite.updateMany).toHaveBeenCalledTimes(2);
  });

  it("falls back to the global env config when the organization has no model policy", async () => {
    const prisma = { organization: { findUnique: vi.fn().mockResolvedValue({ allowedModels: [], defaultModel: null }) } };
    const config = { getOrThrow: vi.fn((key: string) => (key === "review.allowedModels" ? ["gpt-5.6-sol"] : "gpt-5.6-sol")) };
    const service = new OrganizationsService(prisma as any, config as any);

    await expect(service.resolveModelPolicy("org-1")).resolves.toEqual({ allowedModels: ["gpt-5.6-sol"], defaultModel: "gpt-5.6-sol" });
    expect(config.getOrThrow).toHaveBeenCalledWith("review.allowedModels");
    expect(config.getOrThrow).toHaveBeenCalledWith("review.defaultModel");
  });

  it("uses the organization's own model policy when configured, ignoring the env fallback", async () => {
    const prisma = { organization: { findUnique: vi.fn().mockResolvedValue({ allowedModels: ["claude-opus-4-8", "claude-sonnet-5"], defaultModel: "claude-sonnet-5" }) } };
    const config = { getOrThrow: vi.fn() };
    const service = new OrganizationsService(prisma as any, config as any);

    await expect(service.resolveModelPolicy("org-1")).resolves.toEqual({ allowedModels: ["claude-opus-4-8", "claude-sonnet-5"], defaultModel: "claude-sonnet-5" });
    expect(config.getOrThrow).not.toHaveBeenCalled();
  });

  it("rejects resolving the model policy for an organization that does not exist", async () => {
    const prisma = { organization: { findUnique: vi.fn().mockResolvedValue(null) } };
    const service = new OrganizationsService(prisma as any, {} as any);

    await expect(service.resolveModelPolicy("missing-org")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("updates the organization's model policy when defaultModel is in allowedModels", async () => {
    const prisma = { organization: { update: vi.fn().mockResolvedValue({ allowedModels: ["gpt-5.6-sol-high", "gpt-5.6-sol-medium"], defaultModel: "gpt-5.6-sol-medium" }) } };
    const service = new OrganizationsService(prisma as any, {} as any);

    await expect(service.updateModelPolicy("org-1", { allowedModels: ["gpt-5.6-sol-high", "gpt-5.6-sol-medium"], defaultModel: "gpt-5.6-sol-medium" })).resolves.toEqual({ allowedModels: ["gpt-5.6-sol-high", "gpt-5.6-sol-medium"], defaultModel: "gpt-5.6-sol-medium" });
    expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: "org-1" }, data: { allowedModels: ["gpt-5.6-sol-high", "gpt-5.6-sol-medium"], defaultModel: "gpt-5.6-sol-medium" }, select: { allowedModels: true, defaultModel: true } });
  });

  it("rejects updating the model policy when defaultModel is not in allowedModels", async () => {
    const prisma = { organization: { update: vi.fn() } };
    const service = new OrganizationsService(prisma as any, {} as any);

    await expect(service.updateModelPolicy("org-1", { allowedModels: ["a", "b"], defaultModel: "c" })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});

describe("OrganizationsController", () => {
  it("rejects organization paths outside the authenticated organization context", async () => {
    const service = { listMembers: vi.fn() };
    const controller = new OrganizationsController(service as any);
    const auth = { userId: "owner-1", organizationId: "org-1", role: "owner", correlationId: "corr-1" } as any;

    await expect(controller.listMembers(auth, "org-2")).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.listMembers).not.toHaveBeenCalled();
  });

  it("rejects model-policy reads and writes outside the authenticated organization context", async () => {
    const service = { resolveModelPolicy: vi.fn(), updateModelPolicy: vi.fn() };
    const controller = new OrganizationsController(service as any);
    const auth = { userId: "owner-1", organizationId: "org-1", role: "owner", correlationId: "corr-1" } as any;

    await expect(controller.getModelPolicy(auth, "org-2")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.updateModelPolicy(auth, "org-2", { allowedModels: ["a"], defaultModel: "a" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.resolveModelPolicy).not.toHaveBeenCalled();
    expect(service.updateModelPolicy).not.toHaveBeenCalled();
  });

  it("reads and writes the model policy for the authenticated organization", async () => {
    const policy = { allowedModels: ["a", "b"], defaultModel: "b" };
    const service = { resolveModelPolicy: vi.fn().mockResolvedValue(policy), updateModelPolicy: vi.fn().mockResolvedValue(policy) };
    const controller = new OrganizationsController(service as any);
    const auth = { userId: "owner-1", organizationId: "org-1", role: "owner", correlationId: "corr-1" } as any;

    await expect(controller.getModelPolicy(auth, "org-1")).resolves.toEqual(policy);
    await expect(controller.updateModelPolicy(auth, "org-1", { allowedModels: ["a", "b"], defaultModel: "b" })).resolves.toEqual(policy);
    expect(service.resolveModelPolicy).toHaveBeenCalledWith("org-1");
    expect(service.updateModelPolicy).toHaveBeenCalledWith("org-1", { allowedModels: ["a", "b"], defaultModel: "b" });
  });
});
