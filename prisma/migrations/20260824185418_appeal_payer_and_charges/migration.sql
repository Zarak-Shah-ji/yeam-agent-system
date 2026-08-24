-- AlterTable
ALTER TABLE "medicaid_encounters" ADD COLUMN     "billedAmount" DECIMAL(12,2),
ADD COLUMN     "remittanceDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "medicaid_patients" ADD COLUMN     "payerKey" TEXT;
