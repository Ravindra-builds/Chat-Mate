/*
  Warnings:

  - A unique constraint covering the columns `[activeRootId]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[activeChildId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "activeRootId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "activeChildId" TEXT,
ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_activeRootId_key" ON "Conversation"("activeRootId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_activeChildId_key" ON "Message"("activeChildId");

-- CreateIndex
CREATE INDEX "Message_conversationId_parentId_idx" ON "Message"("conversationId", "parentId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_activeRootId_fkey" FOREIGN KEY ("activeRootId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_activeChildId_fkey" FOREIGN KEY ("activeChildId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
