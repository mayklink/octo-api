import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthContext } from "../auth/auth-context";
import { OrganizationOptional } from "../auth/public.decorator";
import { OrganizationsService } from "./organizations.service";

@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @OrganizationOptional()
  async list(@CurrentUser() auth: AuthContext) {
    return { data: await this.organizations.listForUser(auth.userId) };
  }
}
