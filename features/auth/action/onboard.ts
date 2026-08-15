"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

/**
 * Syncs the signed-in Clerk user into the local Prisma `User` table.
 * Handles race conditions and email-matching for account linking.
 *
 * @returns The created or updated Prisma user record.
 * @throws {Error} When no Clerk session is present.
 */
export async function onBoard() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // 1. Fast path: lookup by clerkId
  const existingByClerk = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (existingByClerk) return existingByClerk;

  // 2. Fetch Clerk user profile
  const clerkUser = await currentUser();
  if (!clerkUser) throw new Error("Unauthorized");

  const email = clerkUser.emailAddresses[0]?.emailAddress ?? null;

  // 3. If a record already exists with this email, update its clerkId
  if (email) {
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      return prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          clerkId: clerkUser.id,
          firstName: clerkUser.firstName,
          lastName: clerkUser.lastName,
          imageUrl: clerkUser.imageUrl,
        },
      });
    }
  }

  // 4. Create new user; defensively catch unique constraint collisions (P2002) from concurrent requests
  try {
    return await prisma.user.create({
      data: {
        clerkId: clerkUser.id,
        email,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        imageUrl: clerkUser.imageUrl,
      },
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      const fallback = await prisma.user.findFirst({
        where: {
          OR: [
            { clerkId: clerkUser.id },
            ...(email ? [{ email }] : []),
          ],
        },
      });
      if (fallback) return fallback;
    }
    throw error;
  }
}
