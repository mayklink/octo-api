import { Body, Controller, ForbiddenException, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { CredentialKind } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthContext } from "../auth/auth-context";
import { Roles } from "../auth/roles.decorator";
import { ConfigureCodexDto } from "./credentials.dto";
import { CredentialsService } from "./credentials.service";

@Controller("organizations/:organizationId/integrations")
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Put("codex")
  @Roles("owner", "admin")
  async configureCodex(@CurrentUser() auth: AuthContext, @Param("organizationId", ParseUUIDPipe) organizationId: string, @Body() dto: ConfigureCodexDto) {
    if (auth.organizationId !== organizationId) throw new ForbiddenException("Organization context mismatch");
    const value = this.credentials.validateCodexAuth(dto.authJson);
    await this.credentials.store(organizationId, null, CredentialKind.codex_auth, value);
    return { connected: true, validatedAt: new Date().toISOString() };
  }
}
