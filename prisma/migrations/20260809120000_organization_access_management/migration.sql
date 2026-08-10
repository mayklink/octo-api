-- Organization access management
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

ALTER TABLE "organization_members" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';

CREATE TABLE "organization_invites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'member',
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',
    "invited_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "organization_invites_organization_id_status_expires_at_idx" ON "organization_invites"("organization_id", "status", "expires_at");
CREATE INDEX "organization_invites_email_status_idx" ON "organization_invites"("email", "status");
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
