-- The two practice indexes on the big tables.
--
-- ─ Why this is its own file, and why it is NOT `CONCURRENTLY` ────────────────
--
-- The intent was CREATE INDEX CONCURRENTLY, so that indexing denial_rows does
-- not hold an ACCESS EXCLUSIVE lock on the worklist's main table. That is not
-- available here: Prisma runs a migration file inside a transaction, and
-- Postgres refuses CONCURRENTLY in a transaction block. Putting the statement
-- alone in its own file does not help — it was tried, and the shadow-database
-- check fails with "CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block". There is no Prisma flag to opt a migration out of its transaction.
--
-- So this file builds them normally, which is correct and fast on any table
-- small enough to lock briefly, and stays a single source of truth that
-- `prisma migrate deploy` can apply unattended.
--
-- ─ If these tables are large when you deploy ─────────────────────────────────
--
-- Build the indexes by hand FIRST, against the live database, outside Prisma:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "denial_rows_orgId_practiceId_status_idx"
--     ON "denial_rows"("orgId", "practiceId", "status");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "org_claims_orgId_practiceId_idx"
--     ON "org_claims"("orgId", "practiceId");
--
-- then run `prisma migrate deploy` as normal. The IF NOT EXISTS below makes
-- this migration a no-op that still records itself as applied, so the two paths
-- converge on the same schema and nothing drifts. That is the whole reason the
-- statements are written with IF NOT EXISTS rather than bare CREATE.
--
-- An interrupted CONCURRENTLY build leaves an INVALID index behind that
-- Postgres does not clean up, and IF NOT EXISTS will happily skip past one —
-- leaving an index that is never used and never maintained. After any failed
-- hand-run, check before deploying:
--
--   SELECT c.relname FROM pg_index i
--   JOIN pg_class c ON c.oid = i.indexrelid
--   WHERE NOT i.indisvalid;
--
-- and DROP INDEX CONCURRENTLY anything it names.

CREATE INDEX IF NOT EXISTS "denial_rows_orgId_practiceId_status_idx"
  ON "denial_rows"("orgId", "practiceId", "status");

CREATE INDEX IF NOT EXISTS "org_claims_orgId_practiceId_idx"
  ON "org_claims"("orgId", "practiceId");
