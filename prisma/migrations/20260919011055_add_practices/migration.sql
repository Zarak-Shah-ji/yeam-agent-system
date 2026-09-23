-- Practices: one clinic inside a billing company.
--
-- Additive only. Every column added here is nullable and nothing reads them
-- yet, so this is safe to apply ahead of the code that uses it and safe to
-- leave applied if that code is rolled back.
--
-- The two indexes this migration does NOT create — on denial_rows and
-- org_claims — are in 20260919011200_practice_indexes_concurrently, alone,
-- because those are the big tables and the index has to be built without an
-- exclusive lock. See that file.

-- AlterTable
ALTER TABLE "denial_rows" ADD COLUMN     "practiceId" TEXT;

-- AlterTable
ALTER TABLE "import_batches" ADD COLUMN     "practiceId" TEXT;

-- AlterTable
ALTER TABLE "org_claims" ADD COLUMN     "practiceId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activePracticeId" TEXT;

-- CreateTable
CREATE TABLE "practices" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "practiceName" TEXT,
    "npi" TEXT,
    "tin" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactFax" TEXT,
    "contactEmail" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practices_orgId_archivedAt_idx" ON "practices"("orgId", "archivedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_activePracticeId_fkey" FOREIGN KEY ("activePracticeId") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practices" ADD CONSTRAINT "practices_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_rows" ADD CONSTRAINT "denial_rows_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_claims" ADD CONSTRAINT "org_claims_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "practices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
