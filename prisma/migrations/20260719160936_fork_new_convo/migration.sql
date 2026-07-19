-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "forkedFromConversationId" TEXT,
ADD COLUMN     "forkedFromMessageId" TEXT,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Conversation_forkedFromConversationId_idx" ON "Conversation"("forkedFromConversationId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_forkedFromConversationId_fkey" FOREIGN KEY ("forkedFromConversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_forkedFromMessageId_fkey" FOREIGN KEY ("forkedFromMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
