import { ArrayNotEmpty, IsArray, IsEmail, IsIn, IsString, MaxLength, MinLength } from "class-validator";

const MEMBER_ROLES = ["member", "admin"] as const;
export type ManageableMemberRole = (typeof MEMBER_ROLES)[number];

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(MEMBER_ROLES)
  role!: ManageableMemberRole;
}

export class UpdateMemberRoleDto {
  @IsIn(MEMBER_ROLES)
  role!: ManageableMemberRole;
}

export class UpdateModelPolicyDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(128, { each: true })
  allowedModels!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  defaultModel!: string;
}
