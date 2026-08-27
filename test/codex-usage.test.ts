import { ConfigService } from "@nestjs/config";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexUsageService, normalizeWindows } from "../src/modules/credentials/codex-usage.service";
import { CredentialsController } from "../src/modules/credentials/credentials.controller";
import type { CredentialsService } from "../src/modules/credentials/credentials.service";
import { REQUIRED_ROLES } from "../src/modules/auth/roles.decorator";

const created: string[] = [];
afterEach(async () => { await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("CodexUsageService", () => {
  it("restricts the status route to organization administrators", () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, CredentialsController.prototype.getCodexStatus)).toEqual(["owner", "admin"]);
  });

  it("normalizes provider windows and clamps percentages", () => {
    const windows = normalizeWindows({ rateLimits: {
      primary: { usedPercent: 18.4, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 105, windowDurationMins: 10_080, resetsAt: 1_800_604_800 },
    } });
    expect(windows).toEqual([
      expect.objectContaining({ label: "5 horas", usedPercent: 18.4, remainingPercent: 81.6 }),
      expect.objectContaining({ label: "Semanal", usedPercent: 100, remainingPercent: 0 }),
    ]);
  });

  it("returns not_configured and reports a missing CLI", async () => {
    const credentials = { loadIfConfigured: vi.fn().mockResolvedValue(undefined) } as unknown as CredentialsService;
    const service = new CodexUsageService(new ConfigService({ codex: { binary: "/tmp/octob-definitely-missing-codex" } }), credentials);
    await expect(service.getStatus("org-1")).resolves.toMatchObject({ state: "not_configured", installed: false, configured: false, windows: [] });
  });

  it("reads real JSON-RPC fields in an isolated temporary home", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "octob-codex-usage-test-"));
    created.push(root);
    const executable = path.join(root, "codex");
    const homeMarker = path.join(root, "home.txt");
    await writeFile(executable, `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(homeMarker)}, process.env.CODEX_HOME || "");
if (process.env.RABBITMQ_URL || !fs.existsSync(process.env.CODEX_HOME + "/auth.json")) process.exit(8);
const readline = require("node:readline").createInterface({ input: process.stdin });
readline.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === 1) console.log(JSON.stringify({ id: 1, result: {} }));
  if (request.id === 2) console.log(JSON.stringify({ id: 2, result: { account: { planType: "plus" } } }));
  if (request.id === 3) console.log(JSON.stringify({ id: 3, result: { rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1800604800 } } } }));
});
`, { mode: 0o700 });
    await chmod(executable, 0o700);
    const credentials = { loadIfConfigured: vi.fn().mockResolvedValue({ auth_mode: "chatgpt", tokens: { access_token: "access", refresh_token: "refresh", account_id: "account" } }) } as unknown as CredentialsService;
    const service = new CodexUsageService(new ConfigService({ codex: { binary: executable, statusTimeoutMs: 5_000, statusCacheTtlMs: 1_000 } }), credentials);
    const previous = process.env.RABBITMQ_URL;
    process.env.RABBITMQ_URL = "amqp://must-not-leak";
    try {
      const status = await service.getStatus("org-1");
      expect(status).toMatchObject({ state: "available", installed: true, configured: true, planType: "plus" });
      expect(status.windows).toHaveLength(2);
      const temporaryHome = await readFile(homeMarker, "utf8");
      await expect(access(temporaryHome)).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.RABBITMQ_URL; else process.env.RABBITMQ_URL = previous;
    }
  });

  it("reports API-key consumption without inventing ChatGPT quota windows", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "octob-codex-api-key-status-test-"));
    created.push(root);
    const executable = path.join(root, "codex");
    const loginMarker = path.join(root, "api-key-login.json");
    await writeFile(executable, `#!/usr/bin/env node
const fs = require("node:fs");
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(loginMarker)}, JSON.stringify({
    command: process.argv.slice(2),
    receivedViaStdin: stdin === "sk-test",
    keyInArguments: process.argv.includes("sk-test"),
    keyInEnvironment: Object.values(process.env).includes("sk-test"),
    authExistedBeforeLogin: fs.existsSync(process.env.CODEX_HOME + "/auth.json"),
  }));
  process.exit(process.argv[2] === "login" && process.argv.includes("--with-api-key") && stdin === "sk-test" ? 0 : 4);
});
`, { mode: 0o700 });
    await chmod(executable, 0o700);
    const credentials = { loadIfConfigured: vi.fn().mockResolvedValue({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test" }) } as unknown as CredentialsService;
    const service = new CodexUsageService(new ConfigService({ codex: { binary: executable, statusTimeoutMs: 5_000 } }), credentials);
    await expect(service.getStatus("org-api-key")).resolves.toMatchObject({
      state: "available",
      configured: true,
      installed: true,
      authenticationMode: "api_key",
      planType: null,
      windows: [],
    });
    expect(JSON.parse(await readFile(loginMarker, "utf8"))).toEqual({
      command: ["login", "-c", 'cli_auth_credentials_store="file"', "--with-api-key"],
      receivedViaStdin: true,
      keyInArguments: false,
      keyInEnvironment: false,
      authExistedBeforeLogin: false,
    });
  });
});
