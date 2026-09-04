-- Claims snapshots, and a home for connection requests.
--
-- Hand-edited. Prisma's differ proposed DROP TABLE "denial_batches" followed by
-- CREATE TABLE "import_batches", which drops every existing batch, orphans
-- denial_rows.batchId and then fails re-adding the foreign key. The table is
-- being renamed, not replaced, so this does the rename.

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('DENIALS', 'CLAIMS');

-- CreateEnum
CREATE TYPE "OrgClaimStatus" AS ENUM ('PAID', 'PARTIAL', 'DENIED', 'PENDING', 'REJECTED', 'WRITTEN_OFF', 'UNKNOWN');

-- RenameTable: denial_batches now holds claim rows too, so it is an import batch.
ALTER TABLE "denial_batches" RENAME TO "import_batches";
ALTER TABLE "import_batches" RENAME CONSTRAINT "denial_batches_pkey" TO "import_batches_pkey";
ALTER TABLE "import_batches" RENAME CONSTRAINT "denial_batches_orgId_fkey" TO "import_batches_orgId_fkey";
ALTER INDEX "denial_batches_orgId_createdAt_idx" RENAME TO "import_batches_orgId_createdAt_idx";

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN "kind" "ImportKind" NOT NULL DEFAULT 'DENIALS',
                             ADD COLUMN "statusDerived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "import_batches_orgId_kind_createdAt_idx" ON "import_batches"("orgId", "kind", "createdAt" DESC);

-- CreateTable
CREATE TABLE "org_claims" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "claimNumber" TEXT,
    "payer" TEXT,
    "status" "OrgClaimStatus" NOT NULL DEFAULT 'UNKNOWN',
    "billed" DECIMAL(12,2) NOT NULL,
    "allowed" DECIMAL(12,2),
    "paid" DECIMAL(12,2),
    "patientResp" DECIMAL(12,2),
    "adjustment" DECIMAL(12,2),
    "serviceDate" TIMESTAMP(3),
    "submittedDate" TIMESTAMP(3),
    "remitDate" TIMESTAMP(3),
    "cpt" TEXT,
    "icd10" TEXT,
    "carc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_requests" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestedById" TEXT,
    "system" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_claims_orgId_status_idx" ON "org_claims"("orgId", "status");

-- CreateIndex
CREATE INDEX "org_claims_batchId_idx" ON "org_claims"("batchId");

-- CreateIndex
CREATE INDEX "org_claims_orgId_serviceDate_idx" ON "org_claims"("orgId", "serviceDate");

-- CreateIndex
CREATE INDEX "org_claims_orgId_claimNumber_idx" ON "org_claims"("orgId", "claimNumber");

-- CreateIndex
CREATE INDEX "connection_requests_orgId_createdAt_idx" ON "connection_requests"("orgId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "org_claims" ADD CONSTRAINT "org_claims_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_claims" ADD CONSTRAINT "org_claims_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_requests" ADD CONSTRAINT "connection_requests_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
