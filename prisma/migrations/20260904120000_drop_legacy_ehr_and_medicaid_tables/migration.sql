-- Drop the two retired generations of this product.
--
-- The EHR tables (patients, providers, appointments, encounters, diagnoses,
-- procedures, claims, claim_events, insurance_coverages, payers) and the Texas
-- Medicaid open-data tables (medicaid_*, hcpcs_codes) have no readers left. The
-- code that used them was removed in the commits preceding this migration.
--
-- IRREVERSIBLE, AND NOT AUTO-APPLIED. Read before running:
--
--   * Production: these tables were verified EMPTY on 2026-08-24 — only
--     agent_logs holds data there, and agent_logs is untouched by this file. The
--     /appeals portal reads agent_logs alone and is unaffected.
--
--   * A local dev database seeded from the Medicaid dataset is NOT empty: it
--     carries ~11M rows in medicaid_claims_agg and ~97k in medicaid_providers.
--     The loader that built them (scripts/load-medicaid-data.ts) has been
--     removed, so this cannot be undone by re-running a script. Take a dump
--     first if that data still matters to you.
--
--   * `build` is `prisma generate && next build` and does NOT run
--     `prisma migrate deploy`. Apply this to production by hand BEFORE merging
--     the code that stopped using these tables, or Prisma will select columns
--     that no longer exist.

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_patientId_fkey";

-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_providerId_fkey";

-- DropForeignKey
ALTER TABLE "claim_events" DROP CONSTRAINT "claim_events_claimId_fkey";

-- DropForeignKey
ALTER TABLE "claims" DROP CONSTRAINT "claims_encounterId_fkey";

-- DropForeignKey
ALTER TABLE "claims" DROP CONSTRAINT "claims_patientId_fkey";

-- DropForeignKey
ALTER TABLE "claims" DROP CONSTRAINT "claims_payerId_fkey";

-- DropForeignKey
ALTER TABLE "diagnoses" DROP CONSTRAINT "diagnoses_encounterId_fkey";

-- DropForeignKey
ALTER TABLE "encounters" DROP CONSTRAINT "encounters_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "encounters" DROP CONSTRAINT "encounters_patientId_fkey";

-- DropForeignKey
ALTER TABLE "encounters" DROP CONSTRAINT "encounters_providerId_fkey";

-- DropForeignKey
ALTER TABLE "insurance_coverages" DROP CONSTRAINT "insurance_coverages_patientId_fkey";

-- DropForeignKey
ALTER TABLE "insurance_coverages" DROP CONSTRAINT "insurance_coverages_payerId_fkey";

-- DropForeignKey
ALTER TABLE "medicaid_claims_agg" DROP CONSTRAINT "medicaid_claims_agg_billingNpi_fkey";

-- DropForeignKey
ALTER TABLE "medicaid_claims_agg" DROP CONSTRAINT "medicaid_claims_agg_servicingNpi_fkey";

-- DropForeignKey
ALTER TABLE "medicaid_encounters" DROP CONSTRAINT "medicaid_encounters_billingNpi_fkey";

-- DropForeignKey
ALTER TABLE "medicaid_encounters" DROP CONSTRAINT "medicaid_encounters_patientId_fkey";

-- DropForeignKey
ALTER TABLE "medicaid_encounters" DROP CONSTRAINT "medicaid_encounters_providerNpi_fkey";

-- DropForeignKey
ALTER TABLE "medicaid_patients" DROP CONSTRAINT "medicaid_patients_primaryProviderNpi_fkey";

-- DropForeignKey
ALTER TABLE "procedures" DROP CONSTRAINT "procedures_encounterId_fkey";

-- DropTable
DROP TABLE "appointments";

-- DropTable
DROP TABLE "claim_events";

-- DropTable
DROP TABLE "claims";

-- DropTable
DROP TABLE "diagnoses";

-- DropTable
DROP TABLE "encounters";

-- DropTable
DROP TABLE "hcpcs_codes";

-- DropTable
DROP TABLE "insurance_coverages";

-- DropTable
DROP TABLE "medicaid_claims_agg";

-- DropTable
DROP TABLE "medicaid_encounters";

-- DropTable
DROP TABLE "medicaid_patients";

-- DropTable
DROP TABLE "medicaid_providers";

-- DropTable
DROP TABLE "patients";

-- DropTable
DROP TABLE "payers";

-- DropTable
DROP TABLE "procedures";

-- DropTable
DROP TABLE "providers";

-- DropEnum
DROP TYPE "AppointmentStatus";

-- DropEnum
DROP TYPE "ClaimStatus";

-- DropEnum
DROP TYPE "EncounterStatus";

-- DropEnum
DROP TYPE "PlanType";

