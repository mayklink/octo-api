import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CredentialKind } from "@prisma/client";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexAuthenticationMode, type CodexAuthenticationMode, CredentialsService } from "./credentials.service";

export type CodexCapacityWindow = {
  label: string;
  durationMinutes: number;
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string | null;
};

export type CodexStatus = {
  id: "codex";
  name: "Codex CLI";
  provider: "OpenAI";
  state: "available" | "not_configured" | "unavailable";
  installed: boolean;
  configured: boolean;
  authenticationMode: CodexAuthenticationMode | null;
  planType: string | null;
  windows: CodexCapacityWindow[];
  checkedAt: string;
  message: string;
};

type JsonRpcResponse = { id?: number; result?: unknown; error?: unknown };
type RateLimitWindow = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown };

@Injectable()
export class CodexUsageService {
  private readonly cache = new Map<string, { expiresAt: number; value: CodexStatus }>();

  constructor(private readonly config: ConfigService, private readonly credentials: CredentialsService) {}

  async getStatus(organizationId: string, refresh = false): Promise<CodexStatus> {
    const cached = this.cache.get(organizationId);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value;

    const checkedAt = new Date().toISOString();
    const authJson = await this.credentials.loadIfConfigured(organizationId, null, CredentialKind.codex_auth);
    if (!authJson) {
      const binary = resolveBinary(this.config.get<string>("codex.binary", "node_modules/.bin/codex"));
      const installed = await verifyBinary(binary, this.config.get<number>("codex.statusTimeoutMs", 10_000));
      return this.remember(organizationId, {
        ...baseStatus(checkedAt),
        state: "not_configured",
        installed,
        message: installed
          ? "Conecte uma conta ChatGPT para consultar a franquia do Codex."
          : "Instale a CLI do Codex no serviço da API e conecte uma conta ChatGPT.",
      });
    }

    const authenticationMode = codexAuthenticationMode(authJson);
    if (authenticationMode === "api_key") {
      try {
        await this.verifyAuthentication(authJson);
        return this.remember(organizationId, {
          ...baseStatus(checkedAt), configured: true, installed: true, authenticationMode,
          state: "available",
          message: "API key conectada. O uso é cobrado por consumo e não possui franquia ChatGPT para exibir.",
        });
      } catch (error) {
        const installed = !isMissingBinary(error);
        return this.remember(organizationId, {
          ...baseStatus(checkedAt), configured: true, installed, authenticationMode,
          state: "unavailable",
          message: installed
            ? "A API key não pôde ser carregada pelo Codex. Atualize a credencial e tente novamente."
            : "A CLI do Codex não está instalada no serviço da API.",
        });
      }
    }

    try {
      const snapshot = await this.readSnapshot(authJson);
      const windows = normalizeWindows(snapshot.rateLimits);
      if (!windows.length) {
        return this.remember(organizationId, {
          ...baseStatus(checkedAt), configured: true, installed: true, authenticationMode: "chatgpt",
          state: "unavailable", planType: snapshot.planType,
          message: "O Codex está conectado, mas não informou janelas de franquia para esta conta.",
        });
      }
      return this.remember(organizationId, {
        ...baseStatus(checkedAt), configured: true, installed: true, authenticationMode: "chatgpt",
        state: "available", planType: snapshot.planType, windows,
        message: "Franquia consultada diretamente no Codex.",
      });
    } catch (error) {
      const installed = !isMissingBinary(error);
      return this.remember(organizationId, {
        ...baseStatus(checkedAt), configured: true, installed, authenticationMode,
        state: "unavailable",
        message: installed
          ? "Não foi possível consultar a franquia agora. A credencial pode precisar ser atualizada."
          : "A CLI do Codex não está instalada no serviço da API.",
      });
    }
  }

  private remember(organizationId: string, value: CodexStatus): CodexStatus {
    const ttl = this.config.get<number>("codex.statusCacheTtlMs", 60_000);
    this.cache.set(organizationId, { expiresAt: Date.now() + ttl, value });
    return value;
  }

  private async readSnapshot(authJson: unknown): Promise<{ planType: string | null; rateLimits: unknown }> {
    const directory = await mkdtemp(path.join(tmpdir(), "octob-codex-status-"));
    await chmod(directory, 0o700);
    try {
      await writeFile(path.join(directory, "auth.json"), JSON.stringify(authJson), { mode: 0o600 });
      return await runAppServer(
        resolveBinary(this.config.get<string>("codex.binary", "node_modules/.bin/codex")),
        directory,
        this.config.get<number>("codex.statusTimeoutMs", 10_000),
      );
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async verifyAuthentication(authJson: unknown): Promise<void> {
    const directory = await mkdtemp(path.join(tmpdir(), "octob-codex-status-"));
    await chmod(directory, 0o700);
    try {
      await writeFile(path.join(directory, "auth.json"), JSON.stringify(authJson), { mode: 0o600 });
      await runLoginStatus(
        resolveBinary(this.config.get<string>("codex.binary", "node_modules/.bin/codex")),
        directory,
        this.config.get<number>("codex.statusTimeoutMs", 10_000),
      );
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function baseStatus(checkedAt: string): CodexStatus {
  return { id: "codex", name: "Codex CLI", provider: "OpenAI", state: "unavailable", installed: false, configured: false, authenticationMode: null, planType: null, windows: [], checkedAt, message: "" };
}

function runAppServer(binary: string, home: string, timeoutMs: number): Promise<{ planType: string | null; rateLimits: unknown }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["app-server", "--stdio", "-c", 'cli_auth_credentials_store="file"'], {
      cwd: home,
      env: minimalEnvironment(home),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderrBytes = 0;
    let settled = false;
    let accountRequestsSent = false;
    const responses = new Map<number, JsonRpcResponse>();
    const timer = setTimeout(() => finish(new Error("Codex status query timed out")), timeoutMs);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (error) reject(error);
      else {
        const account = asRecord(responses.get(2)?.result);
        const accountValue = asRecord(account?.account);
        resolve({ planType: stringOrNull(accountValue?.planType), rateLimits: responses.get(3)?.result });
      }
    };

    child.once("error", (error) => finish(error));
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 256 * 1024) finish(new Error("Codex status error output exceeded limit"));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) return finish(new Error("Codex status output exceeded limit"));
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line) as JsonRpcResponse;
          if (typeof response.id === "number") responses.set(response.id, response);
        } catch {
          finish(new Error("Codex returned an invalid protocol response"));
          return;
        }
      }
      const initialization = responses.get(1);
      const account = responses.get(2);
      const limits = responses.get(3);
      if (initialization?.error || account?.error || limits?.error) return finish(new Error("Codex rejected the status query"));
      if (initialization?.result && !accountRequestsSent) {
        accountRequestsSent = true;
        send({ method: "initialized", params: {} });
        send({ method: "account/read", id: 2, params: { refreshToken: false } });
        send({ method: "account/rateLimits/read", id: 3, params: {} });
      }
      if (account?.result && limits?.result) finish();
    });
    child.once("close", (code) => {
      if (!settled) finish(new Error(`Codex status process exited with code ${code ?? "unknown"}`));
    });

    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ method: "initialize", id: 1, params: { clientInfo: { name: "octo-api", title: "Octob API", version: "0.1.0" }, capabilities: { experimentalApi: true } } });
  });
}

export function normalizeWindows(value: unknown): CodexCapacityWindow[] {
  const result = asRecord(value);
  const byId = asRecord(result?.rateLimitsByLimitId);
  const shared = asRecord(byId?.codex) ?? asRecord(result?.rateLimits);
  if (!shared) return [];
  const candidates = [asRecord(shared.primary), asRecord(shared.secondary)].filter((item): item is Record<string, unknown> => Boolean(item));
  return candidates.flatMap((window) => normalizeWindow(window as RateLimitWindow));
}

function normalizeWindow(window: RateLimitWindow): CodexCapacityWindow[] {
  if (typeof window.usedPercent !== "number" || typeof window.windowDurationMins !== "number" || window.windowDurationMins <= 0) return [];
  const usedPercent = clamp(window.usedPercent);
  const resetsAt = typeof window.resetsAt === "number" && Number.isFinite(window.resetsAt) ? new Date(window.resetsAt * 1000).toISOString() : null;
  return [{ label: durationLabel(window.windowDurationMins), durationMinutes: window.windowDurationMins, usedPercent, remainingPercent: clamp(100 - usedPercent), resetsAt }];
}

function durationLabel(minutes: number): string {
  if (minutes === 300) return "5 horas";
  if (minutes === 10_080) return "Semanal";
  if (minutes >= 40_000 && minutes <= 45_000) return "Mensal";
  if (minutes % 1_440 === 0) return `${minutes / 1_440} dias`;
  if (minutes % 60 === 0) return `${minutes / 60} horas`;
  return `${minutes} minutos`;
}

function clamp(value: number): number { return Math.min(100, Math.max(0, Math.round(value * 10) / 10)); }
function asRecord(value: unknown): Record<string, unknown> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringOrNull(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function isMissingBinary(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
function resolveBinary(binary: string): string { return binary.includes(path.sep) && !path.isAbsolute(binary) ? path.resolve(process.cwd(), binary) : binary; }

function verifyBinary(binary: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(binary, ["--version"], { cwd: tmpdir(), env: minimalEnvironment(tmpdir()), stdio: "ignore" });
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolve(available);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
}

function runLoginStatus(binary: string, home: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["login", "status"], {
      cwd: home,
      env: minimalEnvironment(home),
      stdio: "ignore",
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error("Codex authentication check timed out")), timeoutMs);
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(code === 0 ? undefined : new Error("Codex authentication check failed")));
  });
}

function minimalEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    CODEX_HOME: home,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
  };
  for (const name of ["SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"] as const) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}
