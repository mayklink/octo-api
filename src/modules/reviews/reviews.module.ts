import { Module } from "@nestjs/common";
import { AzureDevOpsModule } from "../azure-devops/azure-devops.module";
import { CredentialsModule } from "../credentials/credentials.module";
import { RepositoriesModule } from "../repositories/repositories.module";
import { PublicationService } from "./publication.service";
import { ResultProcessorService } from "./result-processor.service";
import { RetryScheduler } from "./retry.scheduler";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";

@Module({ imports: [RepositoriesModule, CredentialsModule, AzureDevOpsModule], controllers: [ReviewsController], providers: [ReviewsService, ResultProcessorService, RetryScheduler, PublicationService], exports: [ReviewsService, ResultProcessorService] })
export class ReviewsModule {}
