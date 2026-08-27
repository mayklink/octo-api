import { ConfigService } from "@nestjs/config";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_ROLES } from "../src/modules/auth/roles.decorator";
import { CodexDeviceAuthService, type CodexDeviceAuthSession } from "../src/modules/credentials/codex-device-auth.service";
import { CredentialsController } from "../src/modules/credentials/credentials.controller";
import type { CredentialsService } from "../src/modules/credentials/credentials.service";
import type { CodexUsageService } from "../src/modules/credentials/codex-usage.service";

const roots: string[] = [];
const services: CodexDeviceAuthService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.onModuleDestroy()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodexDeviceAuthService", () => {
  it("restricts every device-auth route to organization administrators", () => {
    for (const method of ["startCodexDeviceAuth", "getCodexDeviceAuth", "cancelCodexDeviceAuth"] as const) {
      expect(Reflect.getMetadata(REQUIRED_ROLES, CredentialsController.prototype[method])).toEqual(["owner", "admin"]);
    }
  });

  it("exposes only the OpenAI URL and code, stores validated ChatGPT auth, and removes the temporary home", async () => {
    const root = await mkdtemp(join(tmpdir(), "octob-device-auth-test-"));
    roots.push(root);
    const executable = join(root, "codex");
    const homeMarker = join(root, "home.txt");
    await writeFile(executable, `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(homeMarker)}, process.env.CODEX_HOME || "");
process.stdout.write("\\u001b[94mhttps://auth.openai.com/codex/device\\u001b[0m\\nABCD-12345\\n");
setTimeout(() => {
  fs.writeFileSync(process.env.CODEX_HOME + "/auth.json", JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "access-secret", refresh_token: "refresh-secret", account_id: "account-secret" } }));
  process.exit(0);
}, 80);
`, { mode: 0o700 });
    await chmod(executable, 0o700);
    const store = vi.fn().mockResolvedValue(undefined);
    const credentials = { validateCodexAuth: vi.fn((value) => value), store } as unknown as CredentialsService;
    const invalidate = vi.fn();
    const service = createService(executable, credentials, { invalidate } as unknown as CodexUsageService);

    const started = await service.start("org-1");
    const awaiting = await waitFor(service, "org-1", started.id, (session) => session.state === "awaiting_authorization");
    expect(awaiting).toEqual(expect.objectContaining({ verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-12345" }));
    expect(JSON.stringify(awaiting)).not.toContain("secret");

    const completed = await waitFor(service, "org-1", started.id, (session) => session.state === "completed");
    expect(completed).toMatchObject({ state: "completed", verificationUrl: null, userCode: null });
    expect(store).toHaveBeenCalledWith("org-1", null, "codex_auth", expect.objectContaining({ auth_mode: "chatgpt" }));
    expect(invalidate).toHaveBeenCalledWith("org-1");
    const temporaryHome = await readFile(homeMarker, "utf8");
    await expect(access(temporaryHome)).rejects.toThrow();
  });

  it("rejects a non-OpenAI verification URL and cleans up without storing credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "octob-device-auth-invalid-test-"));
    roots.push(root);
    const executable = join(root, "codex");
    await writeFile(executable, `#!/usr/bin/env node
process.stdout.write("https://evil.example/device\\nABCD-12345\\n");
setInterval(() => undefined, 1000);
`, { mode: 0o700 });
    await chmod(executable, 0o700);
    const store = vi.fn();
    const service = createService(executable, { validateCodexAuth: vi.fn(), store } as unknown as CredentialsService, { invalidate: vi.fn() } as unknown as CodexUsageService);
    const started = await service.start("org-2");
    const failed = await waitFor(service, "org-2", started.id, (session) => session.state === "failed");
    expect(failed).toMatchObject({ state: "failed", verificationUrl: null, userCode: null });
    expect(store).not.toHaveBeenCalled();
  });

  it("cancels an active session and keeps the terminal state available", async () => {
    const root = await mkdtemp(join(tmpdir(), "octob-device-auth-cancel-test-"));
    roots.push(root);
    const executable = join(root, "codex");
    await writeFile(executable, `#!/usr/bin/env node
process.stdout.write("https://auth.openai.com/codex/device\\nWXYZ-67890\\n");
setInterval(() => undefined, 1000);
`, { mode: 0o700 });
    await chmod(executable, 0o700);
    const service = createService(executable, { validateCodexAuth: vi.fn(), store: vi.fn() } as unknown as CredentialsService, { invalidate: vi.fn() } as unknown as CodexUsageService);
    const started = await service.start("org-3");
    await waitFor(service, "org-3", started.id, (session) => session.state === "awaiting_authorization");
    await expect(service.cancel("org-3", started.id)).resolves.toMatchObject({ state: "cancelled", verificationUrl: null, userCode: null });
    expect(service.get("org-3", started.id).state).toBe("cancelled");
  });
});

function createService(binary: string, credentials: CredentialsService, usage: CodexUsageService): CodexDeviceAuthService {
  const service = new CodexDeviceAuthService(new ConfigService({ codex: { binary, deviceAuthTimeoutMs: 2_000 } }), credentials, usage);
  services.push(service);
  return service;
}

async function waitFor(service: CodexDeviceAuthService, organizationId: string, sessionId: string, predicate: (session: CodexDeviceAuthSession) => boolean): Promise<CodexDeviceAuthSession> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const session = service.get(organizationId, sessionId);
    if (predicate(session)) return session;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for device auth state");
}
