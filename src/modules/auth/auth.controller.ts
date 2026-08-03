import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "./current-user.decorator";
import type { AuthContext } from "./auth-context";
import { OrganizationOptional } from "./public.decorator";

@Controller()
export class AuthController {
  @Get("me")
  @OrganizationOptional()
  me(@CurrentUser() auth: AuthContext) { return auth; }
}
