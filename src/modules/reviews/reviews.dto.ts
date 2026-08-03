import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";
export class CreateReviewJobDto { @IsUUID() repositoryId!: string; @IsString() @MinLength(1) @MaxLength(128) pullRequestId!: string; }
export class UpdateReviewSettingsDto {
  @IsString() @MinLength(1) @MaxLength(60000) prompt!: string;
  @IsString() @MinLength(1) @MaxLength(128) model!: string;
  @IsOptional() @IsIn(["info", "warning", "error"]) severityThreshold?: "info" | "warning" | "error";
  @IsBoolean() autoReview!: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(10) maxAttempts?: number;
}
