import { Injectable, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CredentialKind } from "@prisma/client";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { CodexUsageService } from "./codex-usage.service";
import { codexAuthenticationMode, CredentialsService } from "./credentials.service";

export type CodexDeviceAuthState = "starting" | "awaiting_authorization" | "completed" | "failed" | "cancelled";

export type CodexDeviceAuthSession = {
  id: string;
  state: CodexDeviceAuthState;
  verificationUrl: string | null;
  userCode: string | null;
  expiresAt: string;
  message: string;
};

type InternalSession = CodexDeviceAuthSession & {
  organizationId: string;
  directory: string;
  child: ChildProcess;
  output: string;
  timeout: NodeJS.Timeout;
  eviction?: NodeJS.Timeout;
  terminalizing: boolean;
};

const MAX_OUTPUT_BYTES = 64 * 1024;
const TERMINAL_RETENTION_MS = 5 * 60 * 1000;
const ALLOWED_VERIFICATION_HOSTS = new Set(["auth.openai.com"]);
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

@Injectable()
export class CodexDeviceAuthService implements OnModuleDestroy {
  private readonly sessions = new Map<string, InternalSession>();
  private readonly activeByOrganization = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly credentials: CredentialsService,
    private readonly usage: CodexUsageService,
  ) {}

  async start(organizationId: string): Promise<CodexDeviceAuthSession> {
    const activeId = this.activeByOrganization.get(organizationId);
    if (activeId) await this.cancel(organizationId, activeId);

    const directory = await mkdtemp(join(tmpdir(), "octob-codex-device-auth-"));
    await chmod(directory, 0o700);
    const timeoutMs = this.config.get<number>("codex.deviceAuthTimeoutMs", 15 * 60 * 1000);
    const child = spawn(resolveBinary(this.config.get<string>("codex.binary", "node_modules/.bin/codex")), [
      "login", "--device-auth", "-c", 'cli_auth_credentials_store="file"',
    ], { cwd: directory, env: minimalEnvironment(directory), stdio: ["ignore", "pipe", "pipe"] });
    const id = randomUUID();
    const session: InternalSession = {
      id,
      organizationId,
      directory,
      child,
      output: "",
      state: "starting",
      verificationUrl: null,
      userCode: null,
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      message: "Iniciando autorização segura com o ChatGPT.",
      terminalizing: false,
      timeout: setTimeout(() => { void this.fail(session, "O código expirou. Inicie uma nova autorização."); }, timeoutMs),
    };
    this.sessions.set(id, session);
    this.activeByOrganization.set(organizationId, id);

    const consume = (chunk: Buffer) => this.consumeOutput(session, chunk);
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.once("error", () => { void this.fail(session, "Não foi possível iniciar a Codex CLI no servidor."); });
    child.once("close", (code) => {
      if (session.terminalizing || isTerminal(session.state)) return;
      if (code === 0) void this.complete(session);
      else void this.fail(session, "A autorização ChatGPT não foi concluída.");
    });
    return publicSession(session);
  }

  get(organizationId: string, sessionId: string): CodexDeviceAuthSession {
    const session = this.requireSession(organizationId, sessionId);
    return publicSession(session);
  }

  async cancel(organizationId: string, sessionId: string): Promise<CodexDeviceAuthSession> {
    const session = this.requireSession(organizationId, sessionId);
    if (!isTerminal(session.state)) {
      session.terminalizing = true;
      session.state = "cancelled";
      session.message = "Autorização cancelada.";
      session.userCode = null;
      session.verificationUrl = null;
      await this.cleanup(session, true);
      this.retainTerminal(session);
    }
    return publicSession(session);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.cleanup(session, true)));
    this.sessions.clear();
    this.activeByOrganization.clear();
  }

  private consumeOutput(session: InternalSession, chunk: Buffer): void {
    if (session.terminalizing || isTerminal(session.state)) return;
    session.output += chunk.toString("utf8");
    if (Buffer.byteLength(session.output, "utf8") > MAX_OUTPUT_BYTES) {
      void this.fail(session, "A Codex CLI retornou uma resposta inesperadamente grande.");
      return;
    }
    const clean = stripAnsi(session.output);
    const url = clean.match(/https:\/\/[^\s]+/i)?.[0];
    const code = clean.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,8}\b/)?.[0];
    if (!url || !code) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !ALLOWED_VERIFICATION_HOSTS.has(parsed.hostname)) throw new Error("invalid host");
      session.verificationUrl = parsed.toString();
      session.userCode = code;
      session.state = "awaiting_authorization";
      session.message = "Abra o link da OpenAI e informe o código temporário.";
      session.output = "";
    } catch {
      void this.fail(session, "A Codex CLI retornou uma URL de autorização inválida.");
    }
  }

  private async complete(session: InternalSession): Promise<void> {
    if (session.terminalizing || isTerminal(session.state)) return;
    session.terminalizing = true;
    try {
      const value = JSON.parse(await readFile(join(session.directory, "auth.json"), "utf8")) as unknown;
      const validated = this.credentials.validateCodexAuth(value);
      if (codexAuthenticationMode(validated) !== "chatgpt") throw new Error("unexpected authentication mode");
      await this.credentials.store(session.organizationId, null, CredentialKind.codex_auth, validated);
      this.usage.invalidate(session.organizationId);
      await this.cleanup(session, false);
      session.state = "completed";
      session.message = "Conta ChatGPT conectada com segurança.";
      session.userCode = null;
      session.verificationUrl = null;
    } catch {
      session.state = "failed";
      session.message = "A Codex CLI concluiu o login, mas a credencial recebida não era válida.";
      await this.cleanup(session, false);
    } finally {
      this.retainTerminal(session);
    }
  }

  private async fail(session: InternalSession, message: string): Promise<void> {
    if (session.terminalizing || isTerminal(session.state)) return;
    session.terminalizing = true;
    session.state = "failed";
    session.message = message;
    session.userCode = null;
    session.verificationUrl = null;
    await this.cleanup(session, true);
    this.retainTerminal(session);
  }

  private async cleanup(session: InternalSession, kill: boolean): Promise<void> {
    clearTimeout(session.timeout);
    if (session.eviction) clearTimeout(session.eviction);
    if (kill && session.child.exitCode === null && session.child.signalCode === null) session.child.kill("SIGKILL");
    session.output = "";
    await rm(session.directory, { recursive: true, force: true }).catch(() => undefined);
    if (this.activeByOrganization.get(session.organizationId) === session.id) this.activeByOrganization.delete(session.organizationId);
  }

  private retainTerminal(session: InternalSession): void {
    session.eviction = setTimeout(() => this.sessions.delete(session.id), TERMINAL_RETENTION_MS);
    session.eviction.unref?.();
  }

  private requireSession(organizationId: string, sessionId: string): InternalSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.organizationId !== organizationId) throw new NotFoundException("Codex device authorization session was not found");
    return session;
  }
}

function publicSession(session: InternalSession): CodexDeviceAuthSession {
  return { id: session.id, state: session.state, verificationUrl: session.verificationUrl, userCode: session.userCode, expiresAt: session.expiresAt, message: session.message };
}

function isTerminal(state: CodexDeviceAuthState): boolean { return state === "completed" || state === "failed" || state === "cancelled"; }
function stripAnsi(value: string): string { return value.replace(ANSI_ESCAPE_PATTERN, ""); }
function resolveBinary(binary: string): string { return binary.includes(sep) && !isAbsolute(binary) ? resolve(process.cwd(), binary) : binary; }
function minimalEnvironment(home: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: home, CODEX_HOME: home, LANG: process.env.LANG ?? "C.UTF-8", LC_ALL: process.env.LC_ALL ?? "C.UTF-8" };
  for (const name of ["SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "CODEX_CA_CERTIFICATE"] as const) if (process.env[name]) environment[name] = process.env[name];
  return environment;
}
