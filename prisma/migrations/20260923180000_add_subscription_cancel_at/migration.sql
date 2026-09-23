-- When a requested cancellation takes effect. Nullable: nothing is pending for
-- any existing workspace, and null is also the state after it has happened.
ALTER TABLE "organizations" ADD COLUMN "subscriptionCancelAt" TIMESTAMP(3);
