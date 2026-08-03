import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Logger } from "nestjs-pino";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = error instanceof HttpException ? error.getResponse() : undefined;
    const body = typeof exceptionResponse === "object" && exceptionResponse !== null ? exceptionResponse as Record<string, unknown> : {};
    const message = status >= 500 ? "Internal server error" : body.message ?? (error instanceof Error ? error.message : "Request failed");
    const correlationId = request.headers["x-correlation-id"];
    if (status >= 500) this.logger.error({ err: error, correlationId, method: request.method, path: request.path }, "Unhandled request error");
    else this.logger.warn({ status, correlationId, method: request.method, path: request.path }, "Request rejected");
    response.status(status).json({
      statusCode: status,
      code: typeof body.error === "string" ? body.error.toUpperCase().replaceAll(" ", "_") : `HTTP_${status}`,
      message,
      ...(body.message && Array.isArray(body.message) ? { details: body.message } : {}),
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }
}
