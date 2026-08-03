import { Module } from "@nestjs/common";
import { AzureDevOpsModule } from "../azure-devops/azure-devops.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { RepositoriesController } from "./repositories.controller";
import { RepositoriesService } from "./repositories.service";

@Module({ imports: [CredentialsModule, AzureDevOpsModule], controllers: [RepositoriesController], providers: [RepositoriesService], exports: [RepositoriesService] })
export class RepositoriesModule {}
