import { Body, Controller, HttpCode, Post, Query } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { AzureWebhookQueryDto } from "./webhooks.dto";
import { WebhooksService } from "./webhooks.service";

@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}
  @Public() @Post("azure-devops") @HttpCode(202)
  azureDevOps(@Query() query: AzureWebhookQueryDto, @Body() body: unknown) { return this.webhooks.azureDevOps(query.repository, query.token, body); }
}
