import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const MAX_TRACKED_CLIENTS = 10_000;

type RateWindow = { count: number; resetAt: number };

@Injectable()
export class WebhookRateLimitMiddleware implements NestMiddleware {
  private readonly clients = new Map<string, RateWindow>();

  use(request: Request, response: Response, next: NextFunction): void {
    const now = Date.now();
    const client = request.ip || request.socket.remoteAddress || "unknown";
    let window = this.clients.get(client);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + WINDOW_MS };
      this.clients.set(client, window);
    }
    window.count += 1;
    if (this.clients.size > MAX_TRACKED_CLIENTS) this.removeExpired(now);
    if (window.count > MAX_REQUESTS_PER_WINDOW) {
      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((window.resetAt - now) / 1000))));
      response.status(429).json({ statusCode: 429, code: "RATE_LIMITED", message: "Too many webhook requests" });
      return;
    }
    next();
  }

  private removeExpired(now: number): void {
    for (const [client, window] of this.clients) {
      if (window.resetAt <= now) this.clients.delete(client);
      if (this.clients.size <= MAX_TRACKED_CLIENTS) break;
    }
  }
}
