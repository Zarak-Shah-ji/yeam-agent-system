# Deploying yeam_agent_system to Vercel (Free Tier)

A concise, copy-paste-ready checklist. Follow steps 1–7 in order.

---

## Prerequisites

- [ ] Node 20+ and pnpm installed locally
- [ ] Repo pushed to GitHub (see Step 3 if not yet done)
- [ ] Free accounts at [vercel.com](https://vercel.com) and [supabase.com](https://supabase.com)

---

## Step 1 — Provision a Free PostgreSQL Database (Supabase)

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Choose a region close to your users
3. Once created, go to **Project Settings → Database → Connection string → URI**
4. Copy the URI — it looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
5. Append `?sslmode=require` to the end:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres?sslmode=require
   ```
   Save this — it's your `DATABASE_URL`.

---

## Step 2 — Generate AUTH_SECRET

Run this in your terminal:

```bash
openssl rand -base64 32
```

Copy the output (e.g. `K3x9mP2...`). This is your `AUTH_SECRET`.

---

## Step 3 — Push Repo to GitHub (if not done)

```bash
git init          # skip if already a git repo
git add -A
git commit -m "initial commit"
gh repo create yeam-agent-system --public --push --source=.
```

Or push to an existing remote:

```bash
git push origin main
```

---

## Step 4 — Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → **Import Git Repository**
2. Select your `yeam-agent-system` repo
3. Framework is auto-detected as **Next.js** — leave build settings as-is
   (already configured in `vercel.json`)
4. Click **Environment Variables** and add the following:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Supabase URI from Step 1 |
| `AUTH_SECRET` | Output from Step 2 |
| `NEXTAUTH_URL` | `https://YOUR-PROJECT.vercel.app` *(use your actual Vercel URL)* |
| `GEMINI_API_KEY` | Your Google AI key *(optional — required for AI agent features)* |

> **Note**: `NEXTAUTH_URL` must match your deployed domain exactly, including `https://`.
> You can find your Vercel URL after the first deploy — update this variable then redeploy.

5. Click **Deploy**. First deploy takes ~2 minutes.

---

## Step 5 — Run DB Migrations (one-time, required)

After deploy succeeds, run migrations locally against the production DB:

```bash
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.xxxx.supabase.co:5432/postgres?sslmode=require" \
  pnpm prisma migrate deploy
```

This creates all tables in Supabase. **Must be run before the app is usable.**

---

## Step 6 — Seed Demo Data (optional)

To load the Molina Family Health Clinic demo dataset:

```bash
DATABASE_URL="postgresql://..." pnpm prisma db seed
```

This creates 4 users, 20 patients, 30 appointments, and sample claims.

---

## Step 7 — Verify

1. Visit `https://YOUR-PROJECT.vercel.app/login`
2. Log in with a demo account:
   - `admin@molinaclinic.demo` / `demo1234`
   - `provider@molinaclinic.demo` / `demo1234`
3. Confirm these pages load: `/patients`, `/appointments`, `/analytics`

---

## Environment Variables Summary

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase PostgreSQL URI with `?sslmode=require` |
| `AUTH_SECRET` | Yes | Random 32-char secret for JWT signing |
| `NEXTAUTH_URL` | Yes | Your Vercel deployment URL (e.g. `https://yeam.vercel.app`) |
| `GEMINI_API_KEY` | No | Google AI key — agents stub gracefully without it |

---

## Free Tier Limits

| Limit | Value |
|---|---|
| Bandwidth | 100 GB / month |
| Serverless function timeout | 10 seconds |
| Build timeout | 45 minutes |
| Supabase DB storage | 500 MB (free tier) |

All tRPC endpoints are well within the 10s timeout.

---

## Troubleshooting

**Build fails: "Cannot find module '.prisma/client'"**
> The `build` script runs `prisma generate` before `next build` — verify your `package.json`
> has `"build": "prisma generate && next build"`.

**Login redirects in a loop**
> `NEXTAUTH_URL` does not match your deployed domain. Update it in Vercel dashboard → Redeploy.

**DB connection error on first load**
> Verify `?sslmode=require` is appended to `DATABASE_URL` and migrations ran (Step 5).

**AI agents return stub responses**
> `GEMINI_API_KEY` is missing or invalid. Agents degrade gracefully — this is expected behavior.
