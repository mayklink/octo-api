import { IsBoolean, IsOptional, IsString, IsUrl, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateRepositoryDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsString() @MinLength(1) @MaxLength(160) azureOrganization!: string;
  @IsString() @MinLength(1) @MaxLength(256) azureProjectId!: string;
  @IsString() @MinLength(1) @MaxLength(256) azureRepositoryId!: string;
  @IsUrl({ protocols: ["https"], require_protocol: true }) cloneUrl!: string;
}
export class UpdateRepositoryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
export class ConfigureAzureCredentialDto { @IsString() @MinLength(1) @MaxLength(512) pat!: string; }
export class RepositoryIdDto { @IsUUID() repositoryId!: string; }
export class DiscoverAzureRepositoriesDto {
  @IsString() @MinLength(1) @MaxLength(160) azureOrganization!: string;
  @IsString() @MinLength(1) @MaxLength(512) pat!: string;
}
