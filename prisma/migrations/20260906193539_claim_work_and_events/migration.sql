-- CreateEnum
CREATE TYPE "ClaimEventKind" AS ENUM ('STATUS_CHANGED', 'NOTE_ADDED', 'FOLLOW_UP_SET', 'CODE_CORRECTED', 'REVIEWED', 'SENT_TO_WORKLIST');

-- CreateTable
CREATE TABLE "claim_work" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "statusOverride" "OrgClaimStatus",
    "note" TEXT,
    "followUpAt" TIMESTAMP(3),
    "correctedCpt" TEXT,
    "correctedIcd10" TEXT,
    "correctedCarc" TEXT,
    "reviewBody" TEXT,
    "reviewFactsHash" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "lastTouchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "kind" "ClaimEventKind" NOT NULL,
    "detail" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claim_work_orgId_followUpAt_idx" ON "claim_work"("orgId", "followUpAt");

-- CreateIndex
CREATE UNIQUE INDEX "claim_work_orgId_claimNumber_key" ON "claim_work"("orgId", "claimNumber");

-- CreateIndex
CREATE INDEX "claim_events_orgId_workId_createdAt_idx" ON "claim_events"("orgId", "workId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "claim_work" ADD CONSTRAINT "claim_work_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_workId_fkey" FOREIGN KEY ("workId") REFERENCES "claim_work"("id") ON DELETE CASCADE ON UPDATE CASCADE;
