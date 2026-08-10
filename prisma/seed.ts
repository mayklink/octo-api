import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const organizationId = process.env.SEED_ORGANIZATION_ID;
  const userId = process.env.SEED_USER_ID;
  const email = process.env.SEED_USER_EMAIL ?? "";
  if (!organizationId || !userId) throw new Error("SEED_ORGANIZATION_ID and SEED_USER_ID are required");
  try {
    await prisma.organization.upsert({ where: { id: organizationId }, update: { name: process.env.SEED_ORGANIZATION_NAME ?? "Octob" }, create: { id: organizationId, name: process.env.SEED_ORGANIZATION_NAME ?? "Octob", slug: "octob" } });
    await prisma.organizationMember.upsert({ where: { organizationId_userId: { organizationId, userId } }, update: { role: "owner", email }, create: { organizationId, userId, role: "owner", email } });
  } finally { await prisma.$disconnect(); }
}
void main();
