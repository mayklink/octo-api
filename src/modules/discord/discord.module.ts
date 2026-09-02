import { Module } from "@nestjs/common";
import { CredentialsModule } from "../credentials/credentials.module";
import { DiscordWebhookService } from "./discord-webhook.service";

@Module({ imports: [CredentialsModule], providers: [DiscordWebhookService], exports: [DiscordWebhookService] })
export class DiscordModule {}
