import { EventEmitter } from "node:events";
import { ConfigService } from "@nestjs/config";
import { CredentialKind } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexUsageService } from "../src/modules/credentials/codex-usage.service";
import { CredentialsService } from "../src/modules/credentials/credentials.service";

const runtime = vi.hoisted(() => ({ file: "", rotate: true, fail: false, closed: false, order: [] as string[] }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async () => "/fake/codex-status"),
  chmod: vi.fn(async () => undefined),
  writeFile: vi.fn(async (_path: string, value: string) => { runtime.file = value; }),
  readFile: vi.fn(async () => {
    expect(runtime.closed).toBe(true);
    return runtime.file;
  }),
  rm: vi.fn(async () => { runtime.order.push("cleanup"); runtime.file = ""; }),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => {
  const child = new EventEmitter();
  const stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  return Object.assign(child, {
    stdout, stderr: new EventEmitter(),
    kill: () => { queueMicrotask(() => { runtime.closed = true; child.emit("close", null); }); return true; },
    stdin: { write: (line: string) => {
      const request = JSON.parse(line) as { id?: number };
      if (!request.id) return;
      queueMicrotask(() => {
        let result: unknown = {};
        if (request.id === 2) result = { account: { planType: "plus" } };
        if (request.id === 3) {
          if (runtime.rotate) {
            const auth = JSON.parse(runtime.file);
            auth.tokens.refresh_token = "new-refresh";
            runtime.file = JSON.stringify(auth);
          }
          result = { rateLimits: { primary: { usedPercent: 0, windowDurationMins: 300 } } };
        }
        stdout.emit("data", `${JSON.stringify(runtime.fail && request.id === 3 ? { id: 3, error: { message: "query failed" } } : { id: request.id, result })}\n`);
      });
    } },
  });
}) }));

const auth = { auth_mode: "chatgpt", tokens: { access_token: "fake-access", refresh_token: "old-refresh", account_id: "fake-account" } };
beforeEach(() => { runtime.file = ""; runtime.rotate = true; runtime.fail = false; runtime.closed = false; runtime.order = []; vi.clearAllMocks(); });

function usageFixture() {
  const credentials = {
    loadIfConfigured: vi.fn(async () => structuredClone(auth)),
    persistCodexAuthRefresh: vi.fn(async () => { runtime.order.push("persist"); return true; }),
  };
  return { credentials, service: new CodexUsageService(new ConfigService({}), credentials as unknown as CredentialsService) };
}

describe("Codex quota credential rotation", () => {
  it("persists rotated tokens before cleanup without exposing them in the quota response", async () => {
    const { service, credentials } = usageFixture();
    const status = await service.getStatus("org");
    expect(status.state).toBe("available");
    expect(credentials.persistCodexAuthRefresh).toHaveBeenCalledWith("org", "old-refresh", { ...auth, tokens: { ...auth.tokens, refresh_token: "new-refresh" } });
    expect(runtime.order).toEqual(["persist", "cleanup"]);
    expect(JSON.stringify(status)).not.toContain("refresh");
  });

  it("preserves a rotation even if the subsequent quota request fails", async () => {
    runtime.fail = true;
    const { service, credentials } = usageFixture();
    expect((await service.getStatus("org")).state).toBe("unavailable");
    expect(credentials.persistCodexAuthRefresh).toHaveBeenCalledOnce();
    expect(runtime.order).toEqual(["persist", "cleanup"]);
  });

  it("does not rewrite unchanged credentials", async () => {
    runtime.rotate = false;
    const { service, credentials } = usageFixture();
    expect((await service.getStatus("org")).state).toBe("available");
    expect(credentials.persistCodexAuthRefresh).not.toHaveBeenCalled();
    expect(runtime.order).toEqual(["cleanup"]);
  });

  it("coalesces concurrent forced refreshes for an organization", async () => {
    const { service, credentials } = usageFixture();
    await Promise.all([service.getStatus("org", true), service.getStatus("org", true)]);
    expect(credentials.loadIfConfigured).toHaveBeenCalledOnce();
    expect(credentials.persistCodexAuthRefresh).toHaveBeenCalledOnce();
  });

  it("cleans up and reports unavailable when persistence fails", async () => {
    const { service, credentials } = usageFixture();
    credentials.persistCodexAuthRefresh.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await service.getStatus("org")).state).toBe("unavailable");
    expect(runtime.order).toEqual(["cleanup"]);
  });
});

describe("atomic Codex credential replacement", () => {
  async function fixture() {
    let record: Record<string, unknown> | undefined;
    const table = {
      findFirst: vi.fn(async () => record ? { ...record } : null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { record = { id: "credential", version: 1, ...data }; }),
      updateMany: vi.fn(async ({ where, data }: { where: { version: number }; data: Record<string, unknown> }) => {
        if (!record || record.version !== where.version) return { count: 0 };
        record = { ...record, ...data, version: where.version + 1 };
        return { count: 1 };
      }),
    };
    const prisma = { integrationCredential: table, $transaction: async (work: (tx: unknown) => Promise<void>) => work({ integrationCredential: table }) };
    const key = Buffer.alloc(32, 1).toString("base64");
    const service = new CredentialsService(new ConfigService({ secrets: { dataKey: key, workerKey: key } }), prisma as never);
    await service.store("org", null, CredentialKind.codex_auth, auth);
    return { service, table, advanceVersion: () => { if (record) record.version = 2; } };
  }

  it("saves the encrypted rotation and rejects reuse of the old refresh token", async () => {
    const { service } = await fixture();
    const next = { ...auth, tokens: { ...auth.tokens, refresh_token: "new-refresh" } };
    expect(await service.persistCodexAuthRefresh("org", "old-refresh", next)).toBe(true);
    expect(await service.load("org", null, CredentialKind.codex_auth)).toEqual(next);
    expect(await service.persistCodexAuthRefresh("org", "old-refresh", auth)).toBe(false);
  });

  it("does not overwrite a credential changed between reading and writing", async () => {
    const { service, table, advanceVersion } = await fixture();
    const read = table.findFirst.getMockImplementation()!;
    table.findFirst.mockImplementationOnce(async () => { const snapshot = await read(); advanceVersion(); return snapshot; });
    expect(await service.persistCodexAuthRefresh("org", "old-refresh", auth)).toBe(false);
    expect(table.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "credential", version: 1 } }));
  });

  it("rejects a rotation for a different ChatGPT account", async () => {
    const { service, table } = await fixture();
    expect(await service.persistCodexAuthRefresh("org", "old-refresh", { ...auth, tokens: { ...auth.tokens, account_id: "other" } })).toBe(false);
    expect(table.updateMany).not.toHaveBeenCalled();
  });
});
