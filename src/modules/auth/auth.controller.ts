import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "./current-user.decorator";
import type { AuthContext } from "./auth-context";
import { OrganizationOptional } from "./public.decorator";
import { OrganizationsService } from "../organizations/organizations.service";

@Controller()
export class AuthController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get("me")
  @OrganizationOptional()
  async me(@CurrentUser() auth: AuthContext) {
    if (auth.email) await this.organizations.acceptPendingInvitesForEmail(auth.email, auth.userId);
    return auth;
  }
}
