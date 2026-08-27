import { Module } from "@nestjs/common";
import { CredentialsController } from "./credentials.controller";
import { CredentialsService } from "./credentials.service";
import { CodexUsageService } from "./codex-usage.service";
import { CodexDeviceAuthService } from "./codex-device-auth.service";

@Module({ controllers: [CredentialsController], providers: [CredentialsService, CodexUsageService, CodexDeviceAuthService], exports: [CredentialsService] })
export class CredentialsModule {}
