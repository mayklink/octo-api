import { Body, Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthContext } from "../auth/auth-context";
import { Roles } from "../auth/roles.decorator";
import { CreateReviewJobDto, UpdateReviewSettingsDto } from "./reviews.dto";
import { ReviewsService } from "./reviews.service";

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Get("review-jobs") list(@CurrentUser() auth: AuthContext, @Query("limit", new DefaultValuePipe(25), ParseIntPipe) limit: number) { return this.reviews.list(auth.organizationId!, limit); }
  @Get("review-jobs/:id") get(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) { return this.reviews.get(auth.organizationId!, id); }
  @Post("review-jobs") @Roles("owner", "admin") create(@CurrentUser() auth: AuthContext, @Body() dto: CreateReviewJobDto) { return this.reviews.create(auth.organizationId!, dto, auth.correlationId); }
  @Post("review-jobs/:id/retry") @Roles("owner", "admin") retry(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) { return this.reviews.retry(auth.organizationId!, id); }
  @Get("review-jobs/:id/findings") findings(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) { return this.reviews.findings(auth.organizationId!, id); }
  @Get("review-settings/allowed-models") allowedModels() { return this.reviews.getAllowedModels(); }
  @Get("review-settings/:repositoryId") settings(@CurrentUser() auth: AuthContext, @Param("repositoryId", ParseUUIDPipe) id: string) { return this.reviews.getSettings(auth.organizationId!, id); }
  @Put("review-settings/:repositoryId") @Roles("owner", "admin") updateSettings(@CurrentUser() auth: AuthContext, @Param("repositoryId", ParseUUIDPipe) id: string, @Body() dto: UpdateReviewSettingsDto) { return this.reviews.updateSettings(auth.organizationId!, id, dto); }
}
