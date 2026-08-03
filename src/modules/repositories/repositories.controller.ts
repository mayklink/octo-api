import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthContext } from "../auth/auth-context";
import { Roles } from "../auth/roles.decorator";
import { ConfigureAzureCredentialDto, CreateRepositoryDto, UpdateRepositoryDto } from "./repositories.dto";
import { RepositoriesService } from "./repositories.service";

@Controller("repositories")
export class RepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}
  @Get() list(@CurrentUser() auth: AuthContext) { return this.repositories.list(auth.organizationId!); }
  @Post() @Roles("owner", "admin") create(@CurrentUser() auth: AuthContext, @Body() dto: CreateRepositoryDto) { return this.repositories.create(auth.organizationId!, dto); }
  @Patch(":id") @Roles("owner", "admin") update(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateRepositoryDto) { return this.repositories.update(auth.organizationId!, id, dto); }
  @Put(":id/integrations/azure-devops") @Roles("owner", "admin") configureAzure(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ConfigureAzureCredentialDto) { return this.repositories.configureAzure(auth.organizationId!, id, dto.pat); }
  @Post(":id/webhook-secret/rotate") @Roles("owner", "admin") rotate(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) { return this.repositories.rotateWebhook(auth.organizationId!, id); }
}
