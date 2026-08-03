import { Module } from "@nestjs/common";
import { CredentialsModule } from "../credentials/credentials.module";
import { AzureDevOpsAdapter } from "./azure-devops.adapter";

@Module({ imports: [CredentialsModule], providers: [AzureDevOpsAdapter], exports: [AzureDevOpsAdapter] })
export class AzureDevOpsModule {}
