import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { MemberRole } from "@prisma/client";
import type { Request } from "express";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { IS_PUBLIC, ORGANIZATION_OPTIONAL } from "./public.decorator";
import { REQUIRED_ROLES } from "./roles.decorator";
import { JwksService } from "./jwks.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwks: JwksService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new UnauthorizedException("Missing bearer token");
    let payload;
    try { payload = await this.jwks.verify(authorization.slice(7)); }
    catch { throw new UnauthorizedException("Invalid or expired access token"); }
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) throw new UnauthorizedException("Invalid token subject");
    if (payload.role !== "authenticated") throw new UnauthorizedException("Only authenticated users are accepted");

    const correlationId = String(request.headers["x-correlation-id"] ?? crypto.randomUUID());
    const optional = this.reflector.getAllAndOverride<boolean>(ORGANIZATION_OPTIONAL, [context.getHandler(), context.getClass()]);
    const organizationHeader = request.headers["x-organization-id"];
    if (!organizationHeader && optional) {
      request.auth = { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined, correlationId };
      return true;
    }
    if (typeof organizationHeader !== "string" || !UUID.test(organizationHeader)) throw new BadRequestException("X-Organization-Id must be a UUID");
    const membership = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: organizationHeader, userId: payload.sub } } });
    if (!membership) throw new ForbiddenException("User is not a member of this organization");
    const roles = this.reflector.getAllAndOverride<MemberRole[]>(REQUIRED_ROLES, [context.getHandler(), context.getClass()]);
    if (roles?.length && !roles.includes(membership.role)) throw new ForbiddenException("Insufficient organization role");
    request.auth = { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined, organizationId: organizationHeader, role: membership.role, correlationId };
    return true;
  }
}
