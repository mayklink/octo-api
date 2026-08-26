import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggerModule } from "nestjs-pino";
import configuration from "./config/configuration";
import { validateEnvironment } from "./config/environment";
import { CorrelationIdMiddleware } from "./common/correlation-id.middleware";
import { PrismaModule } from "./infrastructure/prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { SupabaseAuthGuard } from "./modules/auth/supabase-auth.guard";
import { HealthModule } from "./modules/health/health.module";
import { OrganizationsModule } from "./modules/organizations/organizations.module";
import { CredentialsModule } from "./modules/credentials/credentials.module";
import { AzureDevOpsModule } from "./modules/azure-devops/azure-devops.module";
import { RepositoriesModule } from "./modules/repositories/repositories.module";
import { ReviewsModule } from "./modules/reviews/reviews.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";
import { ContractsModule } from "./modules/contracts/contracts.module";
import { WebhookRateLimitMiddleware } from "./modules/webhooks/webhook-rate-limit.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnvironment }),
    LoggerModule.forRootAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({
      pinoHttp: {
        level: config.get("app.logLevel", "info"),
        redact: { paths: ["req.headers.authorization", "req.query.token", "*.password", "*.pat", "*.authJson", "*.ciphertext", "*.serviceRoleKey", "*.SUPABASE_SERVICE_ROLE_KEY"], censor: "[REDACTED]" },
        serializers: {
          req: (req) => ({ ...req, url: redactWebhookToken(req.url) }),
        },
        genReqId: (req, res) => {
          const incoming = req.headers["x-correlation-id"];
          const id = typeof incoming === "string" && incoming.length <= 128 ? incoming : crypto.randomUUID();
          res.setHeader("x-correlation-id", id);
          return id;
        },
      },
    }) }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ContractsModule,
    AuthModule,
    HealthModule,
    OrganizationsModule,
    CredentialsModule,
    AzureDevOpsModule,
    RepositoriesModule,
    ReviewsModule,
    MessagingModule,
    WebhooksModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: SupabaseAuthGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
    consumer.apply(WebhookRateLimitMiddleware).forRoutes({ path: "webhooks/azure-devops", method: RequestMethod.POST });
  }
}

function redactWebhookToken(url: string): string {
  const [path, query] = url.split("?", 2);
  if (!query) return url;
  const parameters = new URLSearchParams(query);
  if (!parameters.has("token")) return url;
  parameters.set("token", "[REDACTED]");
  return `${path}?${parameters.toString()}`;
}
