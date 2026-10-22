-- CreateEnum
CREATE TYPE "OutboundEmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_by_email" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "outbound_emails" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "ticket_id" TEXT,
    "kind" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "cc_address" TEXT[],
    "subject" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "in_reply_to" TEXT,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "OutboundEmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbound_emails_message_id_key" ON "outbound_emails"("message_id");

-- CreateIndex
CREATE INDEX "outbound_emails_ticket_id_idx" ON "outbound_emails"("ticket_id");

-- CreateIndex
CREATE INDEX "outbound_emails_status_created_at_idx" ON "outbound_emails"("status", "created_at");

-- AddForeignKey
ALTER TABLE "outbound_emails" ADD CONSTRAINT "outbound_emails_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
