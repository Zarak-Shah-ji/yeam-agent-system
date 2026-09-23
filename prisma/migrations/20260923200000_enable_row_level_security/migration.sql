-- Row-level security on every table, with no policies.
--
-- Supabase serves PostgREST on every project, so anyone holding the project's
-- public anon key could read and write every row here without touching the
-- app — including organizations.plan, the column the paywall sells. The app
-- never uses PostgREST: it connects through Supavisor as `postgres`, which owns
-- every table and has BYPASSRLS, so RLS with no policies changes nothing for it
-- (verified in prod on 2026-09-23: all app connections are postgres/Supavisor,
-- every table is owned by postgres). What it closes is the anon and
-- authenticated roles, which get no rows at all.
--
-- Deliberately no policies. There is no client that should reach these tables
-- directly; a policy would be a door to guard, not a feature.
--
-- Every table added later must enable RLS in its own migration.
-- __tests__/row-level-security.test.ts fails until it does.

ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_work" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connection_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "denial_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "denial_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "denial_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "denial_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "denial_worked_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payer_destinations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "practices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "worklist_preferences" ENABLE ROW LEVEL SECURITY;
