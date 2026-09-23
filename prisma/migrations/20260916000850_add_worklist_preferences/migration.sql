-- CreateTable
CREATE TABLE "worklist_preferences" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "columnWidths" JSONB,
    "splitRatio" DOUBLE PRECISION,
    "lastRowId" TEXT,
    "lastStep" TEXT,
    "worklistSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worklist_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worklist_preferences_orgId_userId_key" ON "worklist_preferences"("orgId", "userId");

-- AddForeignKey
ALTER TABLE "worklist_preferences" ADD CONSTRAINT "worklist_preferences_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worklist_preferences" ADD CONSTRAINT "worklist_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
