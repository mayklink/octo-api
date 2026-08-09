import { Module } from "@nestjs/common";
import { CredentialsModule } from "../credentials/credentials.module";
import { RepositoriesModule } from "../repositories/repositories.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
@Module({ imports: [CredentialsModule, RepositoriesModule, ReviewsModule], controllers: [WebhooksController], providers: [WebhooksService] })
export class WebhooksModule {}
