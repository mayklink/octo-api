import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CredentialKind, type IntegrationCredential } from "@prisma/client";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { EncryptedCredential, ReviewOutcomeV2, ReviewRequestedV2 } from "../contracts/review-contracts";

type StoredValue = { value: unknown };

@Injectable()
export class CredentialsService {
  private readonly dataKey: Buffer;
  private readonly workerKey: Buffer;
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {
    this.dataKey = Buffer.from(config.getOrThrow<string>("secrets.dataKey"), "base64");
    this.workerKey = Buffer.from(config.getOrThrow<string>("secrets.workerKey"), "base64");
  }

  validateCodexAuth(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new BadRequestException("authJson must be an object");
    if (value.OPENAI_API_KEY !== undefined && value.OPENAI_API_KEY !== null) throw new BadRequestException("OPENAI_API_KEY must be absent or null");
    if (!isRecord(value.tokens)) throw new BadRequestException("authJson.tokens is required");
    for (const field of ["access_token", "refresh_token", "account_id"] as const) {
      if (typeof value.tokens[field] !== "string" || !value.tokens[field]) throw new BadRequestException(`authJson.tokens.${field} is required`);
    }
    return value;
  }

  async store(organizationId: string, repositoryId: string | null, kind: CredentialKind, value: unknown): Promise<void> {
    const envelope = this.encryptAtRest({ value }, organizationId, repositoryId, kind);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.integrationCredential.findFirst({ where: { organizationId, repositoryId, kind } });
      if (existing) {
        await tx.integrationCredential.update({ where: { id: existing.id }, data: { ...envelope, version: { increment: 1 }, lastValidatedAt: new Date() } });
      } else {
        await tx.integrationCredential.create({ data: { organizationId, repositoryId, kind, ...envelope, lastValidatedAt: new Date() } });
      }
    });
  }

  async load(organizationId: string, repositoryId: string | null, kind: CredentialKind): Promise<unknown> {
    const credential = await this.prisma.integrationCredential.findFirst({ where: { organizationId, repositoryId, kind } });
    if (!credential) throw new NotFoundException(`${kind} credential is not configured`);
    return this.decryptAtRest(credential, organizationId, repositoryId).value;
  }

  async persistCodexRefresh(event: ReviewOutcomeV2): Promise<boolean> {
    const refresh = event.credentialRefresh;
    if (!refresh) return false;
    if (!event.organizationId || !event.repositoryId) throw new BadRequestException("Credential refresh is missing review identity");
    const organizationId = event.organizationId;
    const key = this.loadWorkerKey(refresh.keyId);
    let payload: { previousRefreshToken: string; authJson: unknown };
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(refresh.iv, "base64"));
      decipher.setAAD(Buffer.from(["octob.review.v2", "engine-refresh", event.causationId, event.jobId, event.organizationId, event.repositoryId, "azure-devops", refresh.keyId].join("\0"), "utf8"));
      decipher.setAuthTag(Buffer.from(refresh.authTag, "base64"));
      payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(refresh.ciphertext, "base64")), decipher.final()]).toString("utf8")) as typeof payload;
    } catch (error) {
      throw new BadRequestException("Invalid Codex credential refresh envelope", { cause: error as Error });
    } finally { key.fill(0); }
    if (!payload || typeof payload.previousRefreshToken !== "string") throw new BadRequestException("Invalid Codex credential refresh payload");
    const next = this.validateCodexAuth(payload.authJson);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.integrationCredential.findFirst({ where: { organizationId, repositoryId: null, kind: CredentialKind.codex_auth } });
      if (!current) return false;
      const currentValue = this.decryptAtRest(current, organizationId, null).value;
      if (!isRecord(currentValue) || !isRecord(currentValue.tokens) || currentValue.tokens.refresh_token !== payload.previousRefreshToken) return false;
      const envelope = this.encryptAtRest({ value: next }, organizationId, null, CredentialKind.codex_auth);
      await tx.integrationCredential.update({ where: { id: current.id }, data: { ...envelope, version: { increment: 1 }, lastValidatedAt: new Date() } });
      return true;
    });
  }

  createWorkerEnvelope(request: Pick<ReviewRequestedV2, "eventId" | "jobId" | "organizationId" | "repositoryId" | "provider" | "clone" | "engine">, purpose: "source-control" | "engine", plaintext: unknown): EncryptedCredential {
    const keyId = "local";
    const aad = ["octob.review.v2", purpose, request.eventId, request.jobId, request.organizationId, request.repositoryId, request.provider, request.clone.url, request.engine.kind, request.engine.model, keyId].join("\0");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.workerKey, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
    return { algorithm: "A256GCM", keyId, iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
  }

  generateWebhookSecret(): { secret: string; hash: string } {
    const secret = randomBytes(32).toString("base64url");
    return { secret, hash: this.hashWebhookSecret(secret) };
  }

  matchesWebhookSecret(secret: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashWebhookSecret(secret), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private hashWebhookSecret(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

  private encryptAtRest(value: StoredValue, organizationId: string, repositoryId: string | null, kind: CredentialKind) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.dataKey, iv);
    cipher.setAAD(Buffer.from(`${organizationId}\0${repositoryId ?? "organization"}\0${kind}`, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return { keyId: "data-local", iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
  }

  private decryptAtRest(credential: IntegrationCredential, organizationId: string, repositoryId: string | null): StoredValue {
    const decipher = createDecipheriv("aes-256-gcm", this.dataKey, Buffer.from(credential.iv, "base64"));
    decipher.setAAD(Buffer.from(`${organizationId}\0${repositoryId ?? "organization"}\0${credential.kind}`, "utf8"));
    decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));
    const clear = Buffer.concat([decipher.update(Buffer.from(credential.ciphertext, "base64")), decipher.final()]).toString("utf8");
    return JSON.parse(clear) as StoredValue;
  }

  private loadWorkerKey(keyId: string): Buffer {
    if (keyId !== "local") throw new BadRequestException("Unsupported credential refresh key");
    return Buffer.from(this.config.getOrThrow<string>("secrets.workerKey"), "base64");
  }
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
