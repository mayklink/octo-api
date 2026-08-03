import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const existing = req.headers["x-correlation-id"];
    const id = typeof existing === "string" && existing.length <= 128 ? existing : crypto.randomUUID();
    req.headers["x-correlation-id"] = id;
    res.setHeader("x-correlation-id", id);
    next();
  }
}
