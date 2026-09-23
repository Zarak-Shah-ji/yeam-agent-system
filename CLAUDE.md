# Yeam.ai — project conventions

Denial management for billing companies. Upload a denials or A/R export, work
the denials, send appeals, measure what wins. Next.js App Router · tRPC · Prisma
· Postgres · Tailwind v4 · vitest (`environment: 'node'`, no React testing lib).

## Two invariants

- **No PHI.** No patient name, member ID or DOB column anywhere in customer-data
  tables. `__tests__/no-phi-columns.test.ts` enforces it; a new model fails it
  until classified. Same rule applies to anything sent to a model — see
  `__tests__/typesafe-state.test.ts`.
- **Never a rate without its denominator.** `52% paid` is meaningless without
  `of 23 claims`. Holds on screen, in prompts, and in collapsed summary lines.
  `MIN_SAMPLE = 5` in `lib/claims/code-signals.ts`.

## Styling

- **Light Tailwind classes only.** `app/globals.css` re-themes
  `--color-<hue>-<shade>` under `.dark`, so `bg-amber-50 text-amber-900` inverts
  on its own. A `dark:` variant inverts it twice —
  `__tests__/dark-variant-inversion.test.ts` fails you.
- **Never `<details>` inside `<p>`.** Invalid HTML: the parser closes the `<p>`
  early, React bails out of hydration and re-renders, which shows up as the app
  flashing from dark to light. Nothing but a browser catches it.

## Verify UI in a browser, not in HTML

`pnpm shot /claims` logs in and screenshots a signed-in page into
`.screenshots/` (gitignored). Exits non-zero on hydration errors.

```
pnpm shot "/claims?claim=<id>&open=codes" --out detail
pnpm shot /settings --as admin@yeam.demo
```

The dashboard is client-rendered behind auth — `curl` returns a shell with no
numbers in it, so it can only confirm wire shapes, never layout.

## Data model

- `OrgClaim` is a **replaceable snapshot**: next month's A/R export supersedes
  it. Human state lives in `ClaimWork`, keyed on `claimNumber`, not a relation —
  it must outlive every re-import.
- Corrected codes render **alongside** the imported ones, never over them.
- Prisma `Decimal` never does arithmetic — convert at the boundary with
  `money()`.
- Type tRPC outputs **explicitly**; `inferRouterOutputs` blows the TS
  instantiation depth limit once a Decimal-bearing model is deep in the union.

## Paywall

`plan` only ever changes in the Stripe webhook. The one exception is
`subscription.setPlanForTesting`, doubly gated on `PLAN_OVERRIDE` (always on
under `next dev`) **and** an ADMIN caller re-read from the database. It lives in
`subscription.ts` so the paywall stays auditable in one file.

## AI

- Gemini (`lib/ai/gemini-client.ts`) writes prose. TypeSafe
  (`lib/ai/typesafe-client.ts`) returns typed judgments bounded to a finite
  criteria map — a code absent from your own history cannot come back.
- Verify the bound; don't trust it. An off-map choice is a `malformed` failure,
  and `offMapCodes()` checks Gemini's prose against `verdict.allowedCodes`.
- TypeSafe `score` is a **fractional weighted position** (e.g. `1.13`), not an
  index. Derive the level from the response's own `legend`.
- Availability is a flag, never a throw: a missing key degrades to "absent", not
  to a page that will not open.

## Local

- **Run on port 3005** — the one `NEXTAUTH_URL` pins — or auth redirects
  dead-end: `pnpm dev --port 3005`.
- Logins (all `demo1234`): `admin@` `billing@` `frontdesk@` `provider@yeam.demo`.
  Plan switching and other admin-only UI needs `admin@`.
- A **stale `pnpm dev` lies**: it holds an old Prisma client and reports
  `Unknown field 'x'` for a field that plainly exists. Restart it. Next 16 locks
  `.next`, so you cannot start a second server to dodge this.
- **Never `prisma migrate dev`** on a tree with pending migrations — it offers a
  reset that drops data. Hand-write the SQL and `prisma migrate deploy`.
- `tsx` scripts must live inside the repo to resolve `node_modules`.
