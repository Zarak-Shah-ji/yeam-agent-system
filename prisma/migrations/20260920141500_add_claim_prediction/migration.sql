-- The bounded verdict, cached next to the prose reading of it.
--
-- Four nullable columns, so this is a no-op for every existing query and nothing
-- reads them until lib/claims/predict.ts lands.

-- AlterTable
ALTER TABLE "claim_work" ADD COLUMN     "predictionBody" JSONB,
ADD COLUMN     "predictionFactsHash" TEXT,
ADD COLUMN     "predictionModel" TEXT,
ADD COLUMN     "predictedAt" TIMESTAMP(3);
