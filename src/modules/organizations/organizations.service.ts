import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({ where: { userId }, include: { organization: true }, orderBy: { createdAt: "asc" } });
    return memberships.map(({ organization, role }) => ({ ...organization, role }));
  }
}
