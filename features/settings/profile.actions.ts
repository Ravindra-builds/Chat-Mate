"use server";

import { requireUser } from "@/features/auth/action/require-user";
import { prisma } from "@/lib/db";

/**
 * Mirrors a Clerk-side name update into the local User table. Clerk itself
 * is the source of truth (updated client-side via `user.update()`) — this
 * just keeps the local copy from drifting, since nothing currently reads
 * it for display (the empty-state greeting reads from Clerk directly), but
 * it's still the record other server-side code might eventually query.
 */
export async function syncProfileName(firstName: string, lastName: string) {
  const user = await requireUser();
  return prisma.user.update({
    where: { id: user.id },
    data: {
      firstName: firstName.trim() || null,
      lastName: lastName.trim() || null,
    },
  });
}