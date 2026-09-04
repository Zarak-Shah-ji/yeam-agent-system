# Yeam.ai

A denial-management tool for medical billing teams. Upload the denials or A/R
export your billing system already produces, see what is still recoverable and
when it expires, and draft the document the payer actually requires.

No API, no clearinghouse feed, no IT ticket. Every billing system — Athena, eCW,
Kareo, AdvancedMD — will export "denials, last 90 days" to CSV or XLSX, and that
file is the whole integration.

---

## What it does

**Upload → triage → draft.**

1. **Connect data** (`/connect`) — drop in a `.csv` or `.xlsx`. The columns are
   mapped and shown to you *before* anything is saved, including a list of the
   columns that were refused.
2. **Worklist** (`/worklist`) — every denial in priority order. The ordering
   mixes the filing deadline, the dollars at stake, how long a row has gone
   untouched and the cost of the remedy, rather than sorting on any one of them.
3. **Draft** — one click per row produces the right *instrument* for that denial
   code: an appeal letter, a corrected-claim transmittal, a reconsideration or a
   reprocessing request. Sending an appeal where the payer wanted a corrected
   claim is the first mistake a billing manager spots.
4. **Claims / Analytics / Payers** — the A/R snapshot as denominator: aging,
   collection rate, denial rate by payer, and which reason codes cost the most.

### De-identification is a schema promise, not a policy

There is no column for a patient name, member ID or date of birth anywhere in
the customer-data tables, so a parser bug cannot quietly persist one.
`lib/imports/deidentify.ts` holds the veto every import profile applies, and it
cannot be opted out of. Widening the set of fields that are read is a legal
change, not a schema change.

---

## Architecture

```
app/
  (auth)/              login, signup
  (dashboard)/         worklist, claims, analytics, payers, connect
  (public)/            /appeals and /how-we-connect — passcode-gated, for
                       sharing with an outside reviewer or prospect
  api/
    agents/chat/       the workspace assistant (SSE, Gemini + 3 read-only tools)
    imports/           preview + commit — the upload path
    appeals/           the passcode portal's drafting endpoint
    public/            server-to-server, for the public demo on yeam.ai

lib/
  imports/             file reading, column mapping, de-identification
  denials/             CARC triage, priority scoring, RARC refinement, drafting
  insights/            read-time aggregation (facts.ts loads, aggregate.ts computes)
  billing/             the domain knowledge: playbooks, payers, procedure codes,
                       and the drafting prompt
  ai/                  Gemini client and the assistant's tool surface

server/trpc/router/     worklist, insights, imports, connections, activity, auth
```

### Two rules the codebase is built around

**Every customer-data query is scoped to one workspace.** `orgProcedure`
(`server/trpc/trpc.ts`) resolves the caller's organization and refuses the
request when there isn't one — a missing org is a 403, never a silent fallback
to reading everything. Route handlers take uploads so they cannot go through
tRPC; they apply the same rule via `requireOrg()` (`lib/org.ts`). A query
without `orgId` in its `where` clause is a data leak between two paying
customers, not a missing filter.

**Nothing derived is stored.** Aging buckets, filing deadlines, denial rates,
priority scores and remedies are all computed on read, because a bucket written
to the database is wrong the next morning and a stored remedy goes stale the
moment the CARC rules are corrected. The performance answer is fewer and
narrower queries — see the per-request memo in `server/trpc/context.ts` — not
cached results.

### One surface, not a demo split

A new workspace is seeded with a sample practice, but it arrives as an
`ImportBatch` flagged `isSample` in the customer's *own* tables and is read
through the identical queries as a real upload. It is deleted whole the moment a
real file lands. There is no parallel demo route, and there should never be one:
it makes the real product look empty on day one and teaches people the good
stuff lives somewhere their data cannot go. See `lib/sample-practice.ts`.

---

## Tech stack

| | |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| API | tRPC v11 + React Query v5 (`httpBatchLink`) |
| Database | PostgreSQL via Prisma 6 |
| Auth | NextAuth v5 — Google OAuth + credentials |
| Model | Google Gemini (`@google/generative-ai`) |
| Styling | Tailwind v4 (`@import "tailwindcss"`, no config file) |
| Tests | Vitest |
| Package manager | pnpm |

---

## Getting started

Requires Node 20+, pnpm and a local PostgreSQL.

```bash
pnpm install
createdb yeam_dev
cp .env.example .env          # fill in DATABASE_URL, AUTH_SECRET, GEMINI_API_KEY
pnpm db:migrate
pnpm db:seed
pnpm dev
```

**Run the dev server on the port `NEXTAUTH_URL` names.** `pnpm dev` is bare
`next dev` and defaults to 3000; if your `.env` pins another port, auth
redirects dead-end. Use `pnpm dev --port 3005` to match.

### Demo logins

All four use the password `demo1234`, and all four belong to the demo
organization:

- `admin@yeam.demo`
- `billing@yeam.demo`
- `frontdesk@yeam.demo`
- `provider@yeam.demo`

If a section looks empty or dead-ends on "not part of a workspace yet", check
`user.orgId` in the database before reading any UI code. `orgProcedure` refuses
a user without an organization, and that symptom looks like a product decision
when it is a one-column auth bug.

### Scripts

```bash
pnpm dev          # dev server
pnpm build        # prisma generate && next build
pnpm test         # vitest
pnpm lint         # eslint
pnpm db:migrate   # prisma migrate dev
pnpm db:seed      # demo org + logins + sample practice
pnpm db:studio    # prisma studio
```

`build` does **not** run `prisma migrate deploy`. A migration must be applied to
production by hand *before* the code that needs it merges, or Prisma will select
columns that do not exist yet.

---

## Deployment

Vercel + Supabase. See [DEPLOY.md](./DEPLOY.md).

---

## Notes worth knowing before you change something

- **`proxy.ts`**, not `middleware.ts` — Next.js 16 renamed the entrypoint.
- **`AUTH_SECRET`**, not `NEXTAUTH_SECRET` — NextAuth v5 convention.
- **`DIRECT_URL`** alongside `DATABASE_URL` — Prisma needs a non-pooled
  connection for migrations when `DATABASE_URL` points at pgBouncer.
- Prisma `Decimal` never does arithmetic. Convert at the boundary with
  `money()` (`lib/money.ts`).
- **Registration is fail-closed.** `SIGNUP_ALLOWED_EMAILS` gates both `/signup`
  and Google auto-provisioning, and it is unset in production — so nobody can
  create an account there. That is a setting, not a bug, but it is also the
  first thing to change before onboarding anyone.
- **There is no invite flow and roles are not enforced.** `User.role` exists and
  the workspace creator is made `ADMIN`, but a billing company cannot yet add
  its second employee.
