import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InviteStatus, MemberRole, Prisma } from "@prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { SupabaseAdminService } from "../auth/supabase-admin.service";
import type { ManageableMemberRole, UpdateModelPolicyDto } from "./organizations.dto";
import { CODEX_MODEL_VALUES } from "../reviews/model-catalog";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ModelPolicy {
  allowedModels: string[];
  defaultModel: string;
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, @Optional() private readonly supabaseAdmin?: SupabaseAdminService) {}

  /**
   * Effective review-model policy for an organization: its own `allowedModels`/
   * `defaultModel` when configured, otherwise the global fallback from
   * `review.allowedModels`/`review.defaultModel` (env vars).
   */
  async resolveModelPolicy(organizationId: string): Promise<ModelPolicy> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { allowedModels: true, defaultModel: true } });
    if (!organization) throw new NotFoundException("Organization not found");
    const allowedModels = organization.allowedModels.length ? organization.allowedModels : this.config.getOrThrow<string[]>("review.allowedModels");
    const defaultModel = organization.defaultModel ?? this.config.getOrThrow<string>("review.defaultModel");
    return { allowedModels, defaultModel };
  }

  async updateModelPolicy(organizationId: string, dto: UpdateModelPolicyDto): Promise<ModelPolicy> {
    if (dto.allowedModels.some((model) => !CODEX_MODEL_VALUES.includes(model as (typeof CODEX_MODEL_VALUES)[number]))) {
      throw new BadRequestException("allowedModels contains an unsupported Codex model option");
    }
    if (!dto.allowedModels.includes(dto.defaultModel)) throw new BadRequestException("defaultModel must be included in allowedModels");
    try {
      const organization = await this.prisma.organization.update({ where: { id: organizationId }, data: { allowedModels: dto.allowedModels, defaultModel: dto.defaultModel }, select: { allowedModels: true, defaultModel: true } });
      return { allowedModels: organization.allowedModels, defaultModel: organization.defaultModel! };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") throw new NotFoundException("Organization not found");
      throw error;
    }
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({ where: { userId }, include: { organization: true }, orderBy: { createdAt: "asc" } });
    return memberships.map(({ organization, role }) => ({ ...organization, role }));
  }

  async inviteMember(organizationId: string, invitedByUserId: string, email: string, role: ManageableMemberRole) {
    const normalizedEmail = normalizeEmail(email);
    if (!this.supabaseAdmin) throw new Error("Supabase admin service is not configured");
    await this.supabaseAdmin.inviteUserByEmail(normalizedEmail);
    return this.prisma.organizationInvite.create({ data: { organizationId, invitedByUserId, email: normalizedEmail, role, status: InviteStatus.pending, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
  }

  async listInvites(organizationId: string) {
    await this.expireInvites(organizationId);
    return this.prisma.organizationInvite.findMany({ where: { organizationId, status: InviteStatus.pending }, orderBy: { createdAt: "desc" } });
  }

  async revokeInvite(organizationId: string, inviteId: string) {
    const result = await this.prisma.organizationInvite.updateMany({ where: { id: inviteId, organizationId, status: InviteStatus.pending }, data: { status: InviteStatus.revoked } });
    if (result.count !== 1) throw new NotFoundException("Pending invite not found");
    return { revoked: true };
  }

  async listMembers(organizationId: string) {
    return this.prisma.organizationMember.findMany({ where: { organizationId }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { organizationId: true, userId: true, email: true, role: true, createdAt: true } });
  }

  async updateMemberRole(organizationId: string, userId: string, role: ManageableMemberRole) {
    const member = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!member) throw new NotFoundException("Organization member not found");
    if (member.role === MemberRole.owner) throw new ForbiddenException("Owner role cannot be changed");
    return this.prisma.organizationMember.update({ where: { organizationId_userId: { organizationId, userId } }, data: { role } });
  }

  async removeMember(organizationId: string, userId: string, requesterUserId: string) {
    const member = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!member) throw new NotFoundException("Organization member not found");
    if (member.role === MemberRole.owner) {
      const ownerCount = await this.prisma.organizationMember.count({ where: { organizationId, role: MemberRole.owner } });
      if (userId === requesterUserId && ownerCount <= 1) throw new ConflictException("The organization must keep at least one owner");
    }
    await this.prisma.organizationMember.delete({ where: { organizationId_userId: { organizationId, userId } } });
    return { removed: true };
  }

  async acceptPendingInvitesForEmail(email: string, userId: string) {
    const normalizedEmail = normalizeEmail(email);
    const invites = await this.prisma.organizationInvite.findMany({ where: { email: normalizedEmail, status: InviteStatus.pending, expiresAt: { lte: new Date() } } });
    const validInvites = await this.prisma.organizationInvite.findMany({ where: { email: normalizedEmail, status: InviteStatus.pending, expiresAt: { gt: new Date() } } });
    if (!invites.length && !validInvites.length) return [];
    if (invites.length) await this.prisma.organizationInvite.updateMany({ where: { id: { in: invites.map((invite) => invite.id) }, status: InviteStatus.pending }, data: { status: InviteStatus.expired } });
    const accepted: string[] = [];
    for (const invite of validInvites) {
      const existing = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: invite.organizationId, userId } } });
      if (!existing) await this.prisma.organizationMember.create({ data: { organizationId: invite.organizationId, userId, email: normalizedEmail, role: invite.role } });
      await this.prisma.organizationInvite.updateMany({ where: { id: invite.id, status: InviteStatus.pending }, data: { status: InviteStatus.accepted, acceptedAt: new Date() } });
      accepted.push(invite.organizationId);
    }
    return accepted;
  }

  private async expireInvites(organizationId: string) {
    await this.prisma.organizationInvite.updateMany({ where: { organizationId, status: InviteStatus.pending, expiresAt: { lte: new Date() } }, data: { status: InviteStatus.expired } });
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new BadRequestException("Email is required");
  return normalized;
}
