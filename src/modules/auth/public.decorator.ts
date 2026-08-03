import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ORGANIZATION_OPTIONAL = "organizationOptional";
export const OrganizationOptional = () => SetMetadata(ORGANIZATION_OPTIONAL, true);
