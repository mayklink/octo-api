import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
export class AzureWebhookQueryDto { @IsUUID() repository!: string; @IsString() @MinLength(32) @MaxLength(128) token!: string; @IsOptional() @IsIn(["source"]) trigger?: "source"; }
