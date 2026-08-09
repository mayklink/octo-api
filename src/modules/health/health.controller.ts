import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { HealthService } from "./health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get("live")
  live() { return { status: "ok", timestamp: new Date().toISOString() }; }

  @Public()
  @Get("ready")
  ready() { return this.health.checkReadiness(); }
}
