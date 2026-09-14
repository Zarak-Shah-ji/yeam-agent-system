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
4. **Send** — where that payer actually takes this instrument (portal, fax or
   mail), the form they refuse submissions without, and what to enclose. Fill
   the patient details, take the packet, then record the channel, the date and
   the confirmation number. That last field is the proof of timely filing.
5. **Record what came back** — the ruling, the date, the amount and the code
   the payer denied the appeal under. Kept on the *attempt*, not the claim, so a
   first-level appeal that lost and a second-level one that won both survive.
6. **Claims / Analytics / Payers** — the A/R snapshot as denominator: aging,
   collection rate, denial rate by payer, and which reason codes cost the most.

### The outcome ledger is the only thing here that cannot be re-imported

Everything else in this app is derived from a file the practice already has. Run
the import again tomorrow and aging, denial rate and the worklist all rebuild
themselves. The one exception is what the payers actually did:

```
payer × reason code × instrument  →  win rate · dollars recovered · days to answer
```

That table is assembled one determination at a time from this workspace's own
history. It is not in any provider manual, any clearinghouse feed or any model's
training data, because payers do not publish how they adjudicate appeals and it
changes every quarter. If it is lost there is no file to restore it from.

Which is why the counting rules are conservative and pinned by tests
(`__tests__/appeal-outcomes.test.ts`). A pending appeal is not a loss. A partial
payment is a win, because in appeals it usually is one. A payer that never
answered has not ruled, and scoring its silence as a denial would blame the
argument. A win rate that is quietly wrong is worse than none at all: a biller
who reads "CO-97 to Cigna never works" stops appealing it, loses money that was
recoverable, and never finds out.

**Most of it fills itself in.** Left to manual entry the wins get recorded —
money arriving is memorable — and the losses do not, which produces a dataset
that is not thin but confidently wrong. So an A/R export closes appeals out on
its own: a claim that was appealed in March and shows paid on the April snapshot,
with a remit dated *after* the appeal went out, is an appeal that worked.
`lib/denials/reconcile.ts` does this and never proposes a loss — a claim still
reading DENIED on a later snapshot is far more likely a line the payer has not
revisited than a ruling. Those stay open, and the worklist says how many.

### De-identification is a schema promise, not a policy

There is no column for a patient name, member ID or date of birth anywhere in
the customer-data tables, so a parser bug cannot quietly persist one.
`lib/imports/deidentify.ts` holds the veto every import profile applies, and it
cannot be opted out of. Widening the set of fields that are read is a legal
change, not a schema change.

That is also why a drafted letter arrives with `[PATIENT NAME]` and `[MEMBER ID]`
still in it. **The send step fills them in the browser.** `lib/appeals/merge.ts`
is pure and runs client-side; the completed letter is printed from the page it
was merged in, and `worklist.recordSubmission` takes a `.strict()` input that
names no patient field, so an identifier cannot reach the server even by
accident. What is stored is the channel, the date and the confirmation number —
the attempt, never the person.

The practice's own details (name, NPI, TIN, address) *are* stored, on
`Organization`. An NPI identifies the billing provider, not a patient. They are
merged into the draft server-side, which is what stopped the model inventing a
plausible-looking practice name for the signature block.

---

## Architecture

```
app/
  (auth)/              login, signup
  (dashboard)/         worklist, claims, analytics, payers, connect, settings
  (public)/            /appeals and /how-we-connect — passcode-gated, for
                       sharing with an outside reviewer or prospect
  api/
    agents/chat/       the workspace assistant (SSE, Gemini + 3 read-only tools)
    imports/           preview + commit — the upload path
    appeals/           the passcode portal's drafting endpoint
    public/            server-to-server, for the public demo on yeam.ai

lib/
  imports/             file reading, column mapping, de-identification
  denials/             CARC triage, priority scoring, RARC refinement, drafting,
                       outcome tallies (outcomes.ts) and the A/R reconciler
  insights/            read-time aggregation (facts.ts loads, aggregate.ts computes)
  billing/             the domain knowledge: playbooks, payers, procedure codes,
                       submission routing, and the drafting prompt
  appeals/             the passcode portal, and the browser-side letter merge
  ai/                  Gemini client and the assistant's tool surface

server/trpc/router/     worklist, insights, imports, connections, settings,
                        activity, auth
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
- **Yeam does not transmit anything.** The send step produces the packet, names
  the destination and records the submission; a human still uploads it to the
  portal or sends the fax. Automating the transmission means PHI transiting the
  server and a signed BAA with whichever vendor carries it — fax is the only
  payer channel that could be automated at all, since provider-facing portals
  have no public API. Treat it as a business decision, not a sprint.
- **`lib/billing/payers.ts` is a Texas panel** and the appeals addresses in it
  are demo data. `resolveDestination` (`lib/billing/submission.ts`) will offer a
  payer's national portal without asserting a state-specific address, and
  resolves to `unknown` rather than guessing. A workspace's own entry under
  Settings → Payer destinations beats the directory every time.
