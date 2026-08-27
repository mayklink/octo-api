import { Module } from "@nestjs/common";
import { CredentialsController } from "./credentials.controller";
import { CredentialsService } from "./credentials.service";
import { CodexUsageService } from "./codex-usage.service";

@Module({ controllers: [CredentialsController], providers: [CredentialsService, CodexUsageService], exports: [CredentialsService] })
export class CredentialsModule {}
