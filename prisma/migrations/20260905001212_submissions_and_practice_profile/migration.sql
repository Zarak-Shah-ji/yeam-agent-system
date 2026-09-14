-- CreateEnum
CREATE TYPE "SubmissionChannel" AS ENUM ('PORTAL', 'FAX', 'MAIL', 'CLEARINGHOUSE', 'PHONE', 'OTHER');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactFax" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "npi" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "practiceName" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "tin" TEXT;

-- CreateTable
CREATE TABLE "denial_submissions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "draftId" TEXT,
    "draftVersion" INTEGER,
    "channel" "SubmissionChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "confirmationRef" TEXT,
    "notes" TEXT,
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "denial_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_destinations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "payerKey" TEXT NOT NULL,
    "payerLabel" TEXT NOT NULL,
    "channel" "SubmissionChannel" NOT NULL,
    "portalUrl" TEXT,
    "faxNumber" TEXT,
    "mailingAddress" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payer_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "denial_submissions_orgId_sentAt_idx" ON "denial_submissions"("orgId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "denial_submissions_rowId_sentAt_idx" ON "denial_submissions"("rowId", "sentAt" DESC);

-- CreateIndex
CREATE INDEX "payer_destinations_orgId_idx" ON "payer_destinations"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "payer_destinations_orgId_payerKey_key" ON "payer_destinations"("orgId", "payerKey");

-- AddForeignKey
ALTER TABLE "denial_submissions" ADD CONSTRAINT "denial_submissions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denial_submissions" ADD CONSTRAINT "denial_submissions_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "denial_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_destinations" ADD CONSTRAINT "payer_destinations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
