import { IsObject } from "class-validator";

export class ConfigureCodexDto {
  @IsObject()
  authJson!: Record<string, unknown>;
}
