import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { ReviewOutcomeV2, ReviewRequestedV2 } from "./review-contracts";
import { reviewCompletedSchema, reviewFailureSchema, reviewRequestedSchema } from "./review.schemas";

@Injectable()
export class ContractsService {
  private readonly requestValidator: ValidateFunction;
  private readonly completedValidator: ValidateFunction;
  private readonly failureValidator: ValidateFunction;
  private readonly maxBytes: number;
  constructor(config: ConfigService) {
    const ajv = new Ajv({ allErrors: true, strict: true }); addFormats(ajv);
    this.failureValidator = ajv.compile(reviewFailureSchema);
    this.completedValidator = ajv.compile(reviewCompletedSchema);
    this.requestValidator = ajv.compile(reviewRequestedSchema);
    this.maxBytes = config.getOrThrow<number>("review.maxMessageBytes");
  }
  assertRequest(value: unknown): asserts value is ReviewRequestedV2 { this.assert(this.requestValidator, value, "review.requested.v2"); if (Buffer.byteLength(JSON.stringify(value)) > this.maxBytes) throw new BadRequestException(`review.requested.v2 exceeds ${this.maxBytes} bytes`); }
  parseOutcome(content: Buffer, routingKey: string): ReviewOutcomeV2 {
    if (content.length > this.maxBytes) throw new BadRequestException("Review outcome exceeds maximum message size");
    let value: unknown; try { value = JSON.parse(content.toString("utf8")); } catch { throw new BadRequestException("Review outcome is not valid JSON"); }
    this.assert(routingKey === "review.completed" ? this.completedValidator : this.failureValidator, value, routingKey);
    const outcome = value as ReviewOutcomeV2;
    if ("failure" in outcome && routingKey === "review.attempt_failed" && outcome.failure.retryable !== true) throw new BadRequestException("attempt_failed must be retryable");
    if ("failure" in outcome && routingKey === "review.failed" && outcome.failure.retryable !== false) throw new BadRequestException("failed must not be retryable");
    return outcome;
  }
  private assert(validator: ValidateFunction, value: unknown, name: string): void { if (!validator(value)) throw new BadRequestException(`Invalid ${name}: ${this.errors(validator)}`); }
  private errors(validator: ValidateFunction): string { return (validator.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ").slice(0, 1000); }
}
