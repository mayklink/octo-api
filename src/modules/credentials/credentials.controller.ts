import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Put, Query } from "@nestjs/common";
import { CredentialKind } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthContext } from "../auth/auth-context";
import { Roles } from "../auth/roles.decorator";
import { CodexUsageService } from "./codex-usage.service";
import { ConfigureCodexDto, ReadCodexStatusDto } from "./credentials.dto";
import { CredentialsService } from "./credentials.service";

@Controller("organizations/:organizationId/integrations")
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService, private readonly codexUsage: CodexUsageService) {}

  @Get("codex/status")
  @Roles("owner", "admin")
  getCodexStatus(@CurrentUser() auth: AuthContext, @Param("organizationId", ParseUUIDPipe) organizationId: string, @Query() query: ReadCodexStatusDto) {
    if (auth.organizationId !== organizationId) throw new ForbiddenException("Organization context mismatch");
    return this.codexUsage.getStatus(organizationId, query.refresh === "true");
  }

  @Put("codex")
  @Roles("owner", "admin")
  async configureCodex(@CurrentUser() auth: AuthContext, @Param("organizationId", ParseUUIDPipe) organizationId: string, @Body() dto: ConfigureCodexDto) {
    if (auth.organizationId !== organizationId) throw new ForbiddenException("Organization context mismatch");
    const { mode, value } = this.credentials.normalizeCodexConfiguration(dto.mode, dto.authJson, dto.apiKey);
    await this.credentials.store(organizationId, null, CredentialKind.codex_auth, value);
    return { connected: true, authenticationMode: mode, validatedAt: new Date().toISOString() };
  }
}
