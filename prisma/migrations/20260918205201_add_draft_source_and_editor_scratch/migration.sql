-- CreateEnum
CREATE TYPE "DraftSource" AS ENUM ('MODEL', 'BILLER');

-- AlterTable
ALTER TABLE "denial_drafts" ADD COLUMN     "noteAt" TIMESTAMP(3),
ADD COLUMN     "source" "DraftSource" NOT NULL DEFAULT 'MODEL';

-- AlterTable
ALTER TABLE "worklist_preferences" ADD COLUMN     "scratchAt" TIMESTAMP(3),
ADD COLUMN     "scratchBaseVersion" INTEGER,
ADD COLUMN     "scratchBody" TEXT,
ADD COLUMN     "scratchRowId" TEXT;
