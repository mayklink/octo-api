import { IsEmail, IsIn } from "class-validator";

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
