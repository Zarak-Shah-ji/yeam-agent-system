-- CreateEnum
CREATE TYPE "DenialEventKind" AS ENUM ('STATUS_CHANGED', 'NOTE_ADDED', 'FOLLOW_UP_SET', 'REOPENED');

-- AlterTable
ALTER TABLE "denial_rows" ADD COLUMN     "reconciledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "denial_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "kind" "DenialEventKind" NOT NULL,
    "detail" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "denial_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "denial_events_orgId_rowId_createdAt_idx" ON "denial_events"("orgId", "rowId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "denial_events" ADD CONSTRAINT "denial_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_events" ADD CONSTRAINT "denial_events_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "denial_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
