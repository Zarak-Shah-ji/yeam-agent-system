-- What Stripe knows about a workspace. `organizations.plan` remains the only
-- column the application reads to decide entitlement; these exist so a webhook
-- can resolve the workspace an event belongs to and so Settings can open the
-- customer's own billing portal.
--
-- All nullable: every existing workspace predates billing and stays on TRIAGE.
-- The unique indexes are safe over the existing rows because Postgres permits
-- many NULLs in a unique index, and every row is NULL here.
ALTER TABLE "organizations" ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripeCustomerId_key" ON "organizations"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripeSubscriptionId_key" ON "organizations"("stripeSubscriptionId");
