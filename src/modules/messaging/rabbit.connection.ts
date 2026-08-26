import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as amqp from "amqplib";
import type { Channel, ChannelModel, ConfirmChannel, ConsumeMessage, Options } from "amqplib";
import { PinoLogger } from "nestjs-pino";
import { ContractsService } from "../contracts/contracts.service";
import { ResultProcessorService } from "../reviews/result-processor.service";
import type { ReviewRequestedV2 } from "../contracts/review-contracts";

type RabbitConfig = { url: string; exchange: string; inputQueue: string; resultsQueue: string; dlx: string };

@Injectable()
export class RabbitConnection implements OnModuleInit, OnModuleDestroy {
  private connection?: ChannelModel; private consumer?: Channel; private publisher?: ConfirmChannel; private shuttingDown = false;
  private readonly returned = new Set<string>();
  isReady = false;
  constructor(private readonly config: ConfigService, private readonly contracts: ContractsService, private readonly results: ResultProcessorService, private readonly logger: PinoLogger) { logger.setContext(RabbitConnection.name); }
  async onModuleInit(): Promise<void> {
    try { await this.connect(); }
    catch (error) { this.logger.error({ err: error }, "Initial RabbitMQ connection failed"); setTimeout(() => void this.reconnect(), 5_000); }
  }
  async onModuleDestroy(): Promise<void> { this.shuttingDown = true; this.isReady = false; await this.consumer?.close().catch(() => undefined); await this.publisher?.close().catch(() => undefined); await this.connection?.close().catch(() => undefined); }

  async publish(event: ReviewRequestedV2): Promise<void> {
    if (!this.publisher || !this.isReady) throw new Error("RabbitMQ publisher is not ready");
    const messageId = String(event.eventId); const body = Buffer.from(JSON.stringify(event));
    const options: Options.Publish = { persistent: true, mandatory: true, contentType: "application/json", contentEncoding: "utf-8", messageId, correlationId: event.correlationId, type: "review.requested.v2", timestamp: Date.now(), headers: { schemaVersion: 2, attempt: event.attempt } };
    await new Promise<void>((resolve, reject) => this.publisher!.publish(this.config.getOrThrow("rabbit.exchange"), "review.requested", body, options, (error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (this.returned.delete(messageId)) throw new Error(`Published message ${messageId} was not routed`);
  }

  private async connect(): Promise<void> {
    const rabbit = this.config.getOrThrow<RabbitConfig>("rabbit");
    this.connection = await amqp.connect(rabbit.url, { timeout: 10_000, clientProperties: { connection_name: `octo-api-${process.pid}` } });
    this.connection.on("error", (error) => this.logger.error({ err: error }, "RabbitMQ connection error"));
    this.connection.on("close", () => { this.isReady = false; if (!this.shuttingDown) setTimeout(() => void this.reconnect(), 5_000); });
    this.consumer = await this.connection.createChannel(); this.publisher = await this.connection.createConfirmChannel();
    this.publisher.on("return", (message: ConsumeMessage) => { if (message.properties.messageId) this.returned.add(String(message.properties.messageId)); });
    await this.consumer.assertExchange(rabbit.exchange, "topic", { durable: true });
    await this.consumer.assertExchange(rabbit.dlx, "topic", { durable: true });
    await this.consumer.assertQueue(rabbit.inputQueue, { durable: true, arguments: { "x-queue-type": "quorum", "x-dead-letter-exchange": rabbit.dlx, "x-dead-letter-routing-key": "review.requested.dead" } });
    await this.consumer.bindQueue(rabbit.inputQueue, rabbit.exchange, "review.requested");
    await this.consumer.assertQueue(`${rabbit.inputQueue}.dlq`, { durable: true, arguments: { "x-queue-type": "quorum" } });
    await this.consumer.bindQueue(`${rabbit.inputQueue}.dlq`, rabbit.dlx, "review.requested.dead");
    await this.consumer.assertQueue(rabbit.resultsQueue, { durable: true, arguments: { "x-queue-type": "quorum", "x-dead-letter-exchange": rabbit.dlx, "x-dead-letter-routing-key": "review.results.dead" } });
    for (const key of ["review.completed", "review.attempt_failed", "review.failed"]) await this.consumer.bindQueue(rabbit.resultsQueue, rabbit.exchange, key);
    await this.consumer.assertQueue(`${rabbit.resultsQueue}.dlq`, { durable: true, arguments: { "x-queue-type": "quorum" } });
    await this.consumer.bindQueue(`${rabbit.resultsQueue}.dlq`, rabbit.dlx, "review.results.dead");
    await this.consumer.prefetch(5);
    await this.consumer.consume(rabbit.resultsQueue, (message) => { if (message) void this.handleResult(message); }, { noAck: false });
    this.isReady = true; this.logger.info("RabbitMQ topology and result consumer are ready");
  }
  private async reconnect(): Promise<void> { try { await this.connect(); } catch (error) { this.logger.error({ err: error }, "RabbitMQ reconnect failed"); if (!this.shuttingDown) setTimeout(() => void this.reconnect(), 10_000); } }
  private async handleResult(message: ConsumeMessage): Promise<void> {
    const routingKey = message.fields.routingKey;
    try {
      if (!["review.completed", "review.attempt_failed", "review.failed"].includes(routingKey)) throw new Error(`Unsupported routing key ${routingKey}`);
      const event = this.contracts.parseOutcome(message.content, routingKey);
      if (message.properties.contentType !== "application/json" || message.properties.type !== `${routingKey}.v2`) throw new Error("AMQP outcome metadata does not match the v2 contract");
      if (message.properties.headers?.schemaVersion !== 2 || message.properties.headers?.attempt !== event.attempt) throw new Error("AMQP outcome headers do not match payload");
      if (message.properties.messageId && message.properties.messageId !== event.eventId) throw new Error("AMQP messageId does not match eventId");
      if (message.properties.correlationId && message.properties.correlationId !== event.correlationId) throw new Error("AMQP correlationId does not match payload");
      await this.results.process(routingKey, event);
      this.consumer!.ack(message);
    } catch (error) {
      const redelivered = message.fields.redelivered;
      this.logger.error({ err: error, routingKey, redelivered }, "Review result processing failed");
      this.consumer!.nack(message, false, !redelivered);
    }
  }
}
