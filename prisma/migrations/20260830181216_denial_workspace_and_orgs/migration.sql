-- CreateEnum
CREATE TYPE "OrgPlan" AS ENUM ('TRIAGE', 'PRACTICE', 'GROUP', 'NETWORK');

-- CreateEnum
CREATE TYPE "DenialRowStatus" AS ENUM ('TO_WORK', 'DRAFTED', 'SENT', 'PAID', 'DEAD');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "orgId" TEXT;

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "OrgPlan" NOT NULL DEFAULT 'TRIAGE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denial_batches" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "droppedColumns" TEXT[],
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "denial_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denial_rows" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "claimNumber" TEXT,
    "payer" TEXT,
    "carc" TEXT NOT NULL,
    "billed" DECIMAL(12,2) NOT NULL,
    "denialDate" TIMESTAMP(3),
    "cpt" TEXT,
    "icd10" TEXT,
    "reason" TEXT,
    "status" "DenialRowStatus" NOT NULL DEFAULT 'TO_WORK',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "denial_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denial_drafts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "artifact" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "summary" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "denial_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denial_worked_events" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "denial_worked_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "denial_batches_orgId_createdAt_idx" ON "denial_batches"("orgId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "denial_rows_orgId_status_idx" ON "denial_rows"("orgId", "status");

-- CreateIndex
CREATE INDEX "denial_rows_batchId_idx" ON "denial_rows"("batchId");

-- CreateIndex
CREATE INDEX "denial_drafts_orgId_createdAt_idx" ON "denial_drafts"("orgId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "denial_drafts_rowId_version_idx" ON "denial_drafts"("rowId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "denial_worked_events_rowId_key" ON "denial_worked_events"("rowId");

-- CreateIndex
CREATE INDEX "denial_worked_events_orgId_createdAt_idx" ON "denial_worked_events"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "users_orgId_idx" ON "users"("orgId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_batches" ADD CONSTRAINT "denial_batches_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_rows" ADD CONSTRAINT "denial_rows_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_rows" ADD CONSTRAINT "denial_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "denial_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_drafts" ADD CONSTRAINT "denial_drafts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_drafts" ADD CONSTRAINT "denial_drafts_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "denial_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_worked_events" ADD CONSTRAINT "denial_worked_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_worked_events" ADD CONSTRAINT "denial_worked_events_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "denial_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
