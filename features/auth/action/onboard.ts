"use server";

import { auth,currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

/**
 * Syncs the signed-in Clerk user into the local Prisma `User` table (upsert).
 *
 * @returns The created or updated Prisma user record.
 * @throws {Error} When no Clerk session is present.
 */
export async function onBoard() {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const existing = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (existing) return existing; // fast path — one cheap indexed lookup, no Clerk API call

    const clerkUser = await currentUser();
    if (!clerkUser) throw new Error("Unauthorized");

    const email = clerkUser.emailAddresses[0]?.emailAddress ?? null;

    return prisma.user.create({
        data: {
            clerkId: clerkUser.id,
            email,
            firstName: clerkUser.firstName,
            lastName: clerkUser.lastName,
            imageUrl: clerkUser.imageUrl,
        },
    })};
