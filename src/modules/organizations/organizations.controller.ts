import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthContext } from "../auth/auth-context";
import { OrganizationOptional } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { InviteMemberDto, UpdateMemberRoleDto } from "./organizations.dto";
import { OrganizationsService } from "./organizations.service";

@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @OrganizationOptional()
  async list(@CurrentUser() auth: AuthContext) { return { data: await this.organizations.listForUser(auth.userId) }; }

  @Post(":organizationId/invites")
  @Roles("owner")
  async invite(@CurrentUser() auth: AuthContext, @Param("organizationId", ParseUUIDPipe) organizationId: string, @Body() dto: InviteMemberDto) {
    this.assertOrganization(auth, organizationId);
    return this.organizations.inviteMember(organizationId, auth.userId, dto.email, dto.role);
  }

  @Get(":organizationId/invites")
  @Roles("owner")
  async listInvites(@CurrentUser() auth: AuthContext, @Param("organizationId", ParseUUIDPipe) organizationId: string) {
    this.assertOrganization(auth, organizationId);
    return this.organizations.listInvites(organizationId);
  }

  @Delete(":organizationId/invites/:inviteId")
  @Roles("owner")
  async revokeInvite(@CurrentUser() auth: AuthContext, @Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("inviteId", ParseUUIDPipe) inviteId: string) {
    this.assertOrganization(auth, organizationId);
    return this.organizations.revokeInvite(organizationId, inviteId);
  }

  @Get(":organizationId/members")
  @Roles("owner")
  async listMembers(@CurrentUser() auth: AuthContext, @Param("organizationId", ParseUUIDPipe) organizationId: string) {
    this.assertOrganization(auth, organizationId);
    return this.organizations.listMembers(organizationId);
  }

  @Patch(":organizationId/members/:userId")
  @Roles("owner")
  async updateMemberRole(@CurrentUser() auth: AuthContext, @Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("userId", ParseUUIDPipe) userId: string, @Body() dto: UpdateMemberRoleDto) {
    this.assertOrganization(auth, organizationId);
    return this.organizations.updateMemberRole(organizationId, userId, dto.role);
  }

  @Delete(":organizationId/members/:userId")
  @Roles("owner")
  async removeMember(@CurrentUser() auth: AuthContext, @Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("userId", ParseUUIDPipe) userId: string) {
    this.assertOrganization(auth, organizationId);
    return this.organizations.removeMember(organizationId, userId, auth.userId);
  }

  private assertOrganization(auth: AuthContext, organizationId: string): void {
    if (auth.organizationId !== organizationId) throw new ForbiddenException("Organization context mismatch");
  }
}
