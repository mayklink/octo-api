import { Module } from "@nestjs/common";
import { AzureDevOpsModule } from "../azure-devops/azure-devops.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { DiscordModule } from "../discord/discord.module";
import { RepositoriesController } from "./repositories.controller";
import { RepositoriesService } from "./repositories.service";

@Module({ imports: [CredentialsModule, AzureDevOpsModule, OrganizationsModule, DiscordModule], controllers: [RepositoriesController], providers: [RepositoriesService], exports: [RepositoriesService] })
export class RepositoriesModule {}
