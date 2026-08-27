import { IsBooleanString, IsIn, IsObject, IsOptional, IsString } from "class-validator";

export class ConfigureCodexDto {
  @IsOptional()
  @IsIn(["chatgpt", "api_key"])
  mode?: "chatgpt" | "api_key";

  @IsOptional()
  @IsObject()
  authJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  apiKey?: string;
}

export class ReadCodexStatusDto {
  @IsOptional()
  @IsBooleanString()
  refresh?: string;
}
