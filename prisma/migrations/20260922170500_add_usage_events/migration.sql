-- CreateEnum
CREATE TYPE "UsageEventName" AS ENUM ('CLAIM_OPENED', 'CLAIM_SECTION_OPENED', 'CLAIM_TO_DRAFTER');

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "name" "UsageEventName" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_events_orgId_name_createdAt_idx" ON "usage_events"("orgId", "name", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
