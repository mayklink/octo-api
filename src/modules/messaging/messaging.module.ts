import { Global, Module } from "@nestjs/common";
import { ReviewsModule } from "../reviews/reviews.module";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";
import { RabbitConnection } from "./rabbit.connection";
import { ReviewAttemptReconcilerService } from "./review-attempt-reconciler.service";

@Global()
@Module({ imports: [ReviewsModule], providers: [RabbitConnection, OutboxDispatcherService, ReviewAttemptReconcilerService], exports: [RabbitConnection] })
export class MessagingModule {}
