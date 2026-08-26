import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/global-exception.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  const config = app.get(ConfigService);
  app.useLogger(logger);
  app.enableShutdownHooks();
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new GlobalExceptionFilter(logger));
  const corsAllowedOrigins = config.getOrThrow<string[]>("app.corsAllowedOrigins");
  app.enableCors({ origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => callback(null, !origin || corsAllowedOrigins.includes(origin)), credentials: false, exposedHeaders: ["x-correlation-id"] });

  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Octob API").setVersion("0.1").addBearerAuth().build());
  SwaggerModule.setup("docs", app, document);
  await app.listen(config.getOrThrow<number>("app.port"));
  logger.log({ port: config.get("app.port") }, "Octob API started");
}

void bootstrap();
