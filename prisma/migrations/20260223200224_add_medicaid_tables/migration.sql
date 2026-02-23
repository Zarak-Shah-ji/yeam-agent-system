-- CreateTable
CREATE TABLE "medicaid_providers" (
    "npi" TEXT NOT NULL,
    "orgName" TEXT,
    "firstName" TEXT,
    "middleName" TEXT,
    "lastName" TEXT,
    "credentials" TEXT,
    "orgNameOther" TEXT,
    "addrLine1" TEXT,
    "addrLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicaid_providers_pkey" PRIMARY KEY ("npi")
);

-- CreateTable
CREATE TABLE "medicaid_claims_agg" (
    "id" TEXT NOT NULL,
    "billingNpi" TEXT NOT NULL,
    "servicingNpi" TEXT,
    "procCode" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "numBeneficiaries" INTEGER,
    "numClaims" INTEGER,
    "paidAmount" DECIMAL(12,2),
    "aoFirstName" TEXT,
    "aoMiddleName" TEXT,
    "aoLastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicaid_claims_agg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicaid_patients" (
    "id" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addrLine1" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'TX',
    "zip" TEXT,
    "insuranceType" TEXT DEFAULT 'Medicaid',
    "insuranceId" TEXT,
    "insuranceStatus" TEXT DEFAULT 'active',
    "primaryProviderNpi" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicaid_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicaid_encounters" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerNpi" TEXT NOT NULL,
    "billingNpi" TEXT,
    "encounterDate" TIMESTAMP(3) NOT NULL,
    "procCode" TEXT NOT NULL,
    "diagnosisCodes" TEXT[],
    "status" TEXT DEFAULT 'completed',
    "claimStatus" TEXT DEFAULT 'clean',
    "paidAmount" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicaid_encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hcpcs_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "avgCostTx" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hcpcs_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medicaid_claims_agg_billingNpi_idx" ON "medicaid_claims_agg"("billingNpi");

-- CreateIndex
CREATE INDEX "medicaid_claims_agg_servicingNpi_idx" ON "medicaid_claims_agg"("servicingNpi");

-- CreateIndex
CREATE INDEX "medicaid_claims_agg_procCode_idx" ON "medicaid_claims_agg"("procCode");

-- CreateIndex
CREATE INDEX "medicaid_claims_agg_yearMonth_idx" ON "medicaid_claims_agg"("yearMonth");

-- CreateIndex
CREATE INDEX "medicaid_claims_agg_billingNpi_procCode_yearMonth_idx" ON "medicaid_claims_agg"("billingNpi", "procCode", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "medicaid_patients_mrn_key" ON "medicaid_patients"("mrn");

-- CreateIndex
CREATE INDEX "medicaid_patients_primaryProviderNpi_idx" ON "medicaid_patients"("primaryProviderNpi");

-- CreateIndex
CREATE INDEX "medicaid_encounters_patientId_idx" ON "medicaid_encounters"("patientId");

-- CreateIndex
CREATE INDEX "medicaid_encounters_providerNpi_idx" ON "medicaid_encounters"("providerNpi");

-- CreateIndex
CREATE INDEX "medicaid_encounters_claimStatus_idx" ON "medicaid_encounters"("claimStatus");

-- CreateIndex
CREATE INDEX "medicaid_encounters_encounterDate_idx" ON "medicaid_encounters"("encounterDate");

-- CreateIndex
CREATE UNIQUE INDEX "hcpcs_codes_code_key" ON "hcpcs_codes"("code");

-- AddForeignKey
ALTER TABLE "medicaid_claims_agg" ADD CONSTRAINT "medicaid_claims_agg_billingNpi_fkey" FOREIGN KEY ("billingNpi") REFERENCES "medicaid_providers"("npi") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicaid_claims_agg" ADD CONSTRAINT "medicaid_claims_agg_servicingNpi_fkey" FOREIGN KEY ("servicingNpi") REFERENCES "medicaid_providers"("npi") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicaid_patients" ADD CONSTRAINT "medicaid_patients_primaryProviderNpi_fkey" FOREIGN KEY ("primaryProviderNpi") REFERENCES "medicaid_providers"("npi") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicaid_encounters" ADD CONSTRAINT "medicaid_encounters_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "medicaid_patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicaid_encounters" ADD CONSTRAINT "medicaid_encounters_providerNpi_fkey" FOREIGN KEY ("providerNpi") REFERENCES "medicaid_providers"("npi") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicaid_encounters" ADD CONSTRAINT "medicaid_encounters_billingNpi_fkey" FOREIGN KEY ("billingNpi") REFERENCES "medicaid_providers"("npi") ON DELETE SET NULL ON UPDATE CASCADE;
