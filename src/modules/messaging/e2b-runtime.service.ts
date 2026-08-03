import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Sandbox } from "e2b";
import { PinoLogger } from "nestjs-pino";

@Injectable()
export class E2bRuntimeService {
  private readonly active = new Map<string, Sandbox>();
  constructor(private readonly config: ConfigService, private readonly logger: PinoLogger) { logger.setContext(E2bRuntimeService.name); }
  async start(metadata: { eventId: string; jobId: string; correlationId: string }): Promise<string> {
    const timeoutMs = this.config.getOrThrow<number>("review.timeoutMs") + 5 * 60_000;
    const sandbox = await Sandbox.create(this.config.getOrThrow<string>("e2b.template"), { apiKey: this.config.getOrThrow<string>("e2b.apiKey"), timeoutMs, metadata });
    this.active.set(sandbox.sandboxId, sandbox);
    await sandbox.commands.run("/usr/bin/tini -s -- node dist/e2b-start-worker.js", { cwd: "/app", background: true, timeoutMs });
    this.logger.info({ sandboxId: sandbox.sandboxId, ...metadata }, "E2B review worker started");
    return sandbox.sandboxId;
  }
  async stop(sandboxId?: string): Promise<void> {
    if (!sandboxId) return;
    const sandbox = this.active.get(sandboxId);
    this.active.delete(sandboxId);
    const operation = sandbox ? sandbox.kill() : Sandbox.kill(sandboxId, { apiKey: this.config.getOrThrow<string>("e2b.apiKey") });
    await operation.catch((error: unknown) => this.logger.warn({ err: error, sandboxId }, "Could not stop E2B sandbox"));
  }
}
