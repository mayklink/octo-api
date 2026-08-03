import { Global, Module } from "@nestjs/common";
import { ReviewsModule } from "../reviews/reviews.module";
import { E2bRuntimeService } from "./e2b-runtime.service";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";
import { RabbitConnection } from "./rabbit.connection";
import { RuntimeReconcilerService } from "./runtime-reconciler.service";

@Global()
@Module({ imports: [ReviewsModule], providers: [RabbitConnection, E2bRuntimeService, OutboxDispatcherService, RuntimeReconcilerService], exports: [RabbitConnection] })
export class MessagingModule {}
