import { SetMetadata } from "@nestjs/common";
import type { MemberRole } from "@prisma/client";

export const REQUIRED_ROLES = "requiredRoles";
export const Roles = (...roles: MemberRole[]) => SetMetadata(REQUIRED_ROLES, roles);
