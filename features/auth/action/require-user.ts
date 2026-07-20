"use server"

import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { onBoard } from "./onboard";

/**
 * Ensures the request is authenticated and returns the linked Prisma `User`.
 *
 * Normally the row already exists — the root layout awaits `onBoard()`
 * before rendering anything. But on a first sign-in, a stale client-side
 * router cache entry can occasionally reach a server action/route before
 * that onboarding write has been observed, so this self-heals by running
 * the same upsert inline rather than throwing and forcing a manual reload.
 */
export async function requireUser() {
    const { userId } = await auth.protect();

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (user) return user;

    return onBoard();
  }