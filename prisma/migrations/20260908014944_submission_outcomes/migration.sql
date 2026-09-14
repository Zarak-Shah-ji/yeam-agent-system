-- CreateEnum
CREATE TYPE "SubmissionOutcome" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'DENIED', 'NO_RESPONSE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OutcomeSource" AS ENUM ('BILLER', 'REMITTANCE');

-- AlterTable
ALTER TABLE "denial_submissions" ADD COLUMN     "amountRecovered" DECIMAL(12,2),
ADD COLUMN     "outcome" "SubmissionOutcome" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "outcomeAt" TIMESTAMP(3),
ADD COLUMN     "outcomeById" TEXT,
ADD COLUMN     "outcomeCarc" TEXT,
ADD COLUMN     "outcomeNote" TEXT,
ADD COLUMN     "outcomeRecordedAt" TIMESTAMP(3),
ADD COLUMN     "outcomeSource" "OutcomeSource";

-- CreateIndex
CREATE INDEX "denial_submissions_orgId_outcome_sentAt_idx" ON "denial_submissions"("orgId", "outcome", "sentAt");
