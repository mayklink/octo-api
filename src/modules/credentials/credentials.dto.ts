import { IsBooleanString, IsObject, IsOptional } from "class-validator";

export class ConfigureCodexDto {
  @IsObject()
  authJson!: Record<string, unknown>;
}

export class ReadCodexStatusDto {
  @IsOptional()
  @IsBooleanString()
  refresh?: string;
}
