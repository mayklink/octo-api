import type { MemberRole } from "@prisma/client";

export type AuthContext = {
  userId: string;
  email?: string;
  organizationId?: string;
  role?: MemberRole;
  correlationId: string;
};

declare global {
  namespace Express { interface Request { auth?: AuthContext } }
}
