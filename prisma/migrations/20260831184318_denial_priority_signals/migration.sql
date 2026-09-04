-- AlterTable
ALTER TABLE "denial_rows" ADD COLUMN     "followUpAt" TIMESTAMP(3),
ADD COLUMN     "lastTouchedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "denial_rows_orgId_followUpAt_idx" ON "denial_rows"("orgId", "followUpAt");
