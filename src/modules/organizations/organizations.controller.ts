import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthContext } from "../auth/auth-context";
import { OrganizationOptional } from "../auth/public.decorator";

@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  @OrganizationOptional()
  async list(@CurrentUser() auth: AuthContext) {
    const memberships = await this.prisma.organizationMember.findMany({ where: { userId: auth.userId }, include: { organization: true }, orderBy: { createdAt: "asc" } });
    return { data: memberships.map(({ organization, role }) => ({ ...organization, role })) };
  }
}
