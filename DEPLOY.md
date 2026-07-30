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
| `AUTH_URL` | `https://app.yeam.ai` *(the canonical public domain)* |
| `GEMINI_API_KEY` | Your Google AI key *(optional — required for AI agent features)* |

> **Note**: `AUTH_URL` must match the domain users actually browse, exactly, including
> `https://`. Point it at the custom domain — not the `*.vercel.app` alias — or OAuth
> will bounce users off `app.yeam.ai` mid-sign-in.

5. Click **Deploy**. First deploy takes ~2 minutes.

---

## Step 4b — Point `app.yeam.ai` at the Deployment

The custom domain has two halves: the domain must be **attached to the Vercel project**,
and DNS must **resolve** to Vercel. Both are required — attaching alone does nothing.

### 1. Attach the domain in Vercel

Vercel dashboard → project `yeam_agent_system` → **Settings → Domains** → add `app.yeam.ai`.
Vercel will show it as *Invalid Configuration* until step 2 is done.

### 2. Add the DNS record at your registrar

`yeam.ai` is on **Namecheap** (nameservers `dns1/dns2.registrar-servers.com`), so the
record is added in Namecheap, not in Vercel.

Namecheap → **Domain List → yeam.ai → Manage → Advanced DNS → Add New Record**:

| Field | Value |
|---|---|
| Type | `CNAME Record` |
| Host | `app` |
| Target | `cname.vercel-dns.com` |
| TTL | `Automatic` |

Leave the existing apex/`www` records (pointing at `76.76.21.21` for the marketing site)
untouched — this adds a subdomain alongside them.

> Namecheap appends the domain automatically: Host `app` means `app.yeam.ai`.
> Do **not** enter `app.yeam.ai` as the host, or you'll get `app.yeam.ai.yeam.ai`.

### 3. Wait for propagation, then verify

DNS usually resolves within 5–30 minutes. Vercel issues the TLS certificate
automatically once it sees the record.

```bash
dig +short app.yeam.ai          # expect a CNAME to cname.vercel-dns.com
curl -sSI https://app.yeam.ai   # expect HTTP 200 (or a 307 to /login)
```

Vercel's **Settings → Domains** panel should flip from *Invalid Configuration* to a
green checkmark.

### 4. Update the OAuth provider consoles

Sign-in will fail with `redirect_uri_mismatch` on the new domain until these are added:

- **Google Cloud Console** → APIs & Services → Credentials → your OAuth client →
  *Authorized redirect URIs* → add `https://app.yeam.ai/api/auth/callback/google`
- **GitHub** → Settings → Developer settings → OAuth Apps → your app →
  *Authorization callback URL* → set to `https://app.yeam.ai/api/auth/callback/github`

Also confirm `AUTH_URL` is `https://app.yeam.ai` in Vercel → Settings → Environment
Variables, and **redeploy** — env var changes only take effect on a new deployment.

### Note on deployment protection

This project runs Vercel Authentication with scope `all_except_custom_domains`, so
`app.yeam.ai` is publicly reachable while the `*.vercel.app` preview URLs stay
login-gated. That's the intended setup — don't switch the scope to `all` unless you
want the public domain gated too.

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

To load the Yeam Health Clinic demo dataset:

```bash
DATABASE_URL="postgresql://..." pnpm prisma db seed
```

This creates 4 users, 20 patients, 30 appointments, and sample claims.

---

## Step 7 — Verify

1. Visit `https://app.yeam.ai/login`
2. Log in with a demo account:
   - `admin@yeam.demo` / `demo1234`
   - `provider@yeam.demo` / `demo1234`
3. Confirm these pages load: `/patients`, `/appointments`, `/analytics`

---

## Environment Variables Summary

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Supabase PostgreSQL URI with `?sslmode=require` |
| `AUTH_SECRET` | Yes | Random 32-char secret for JWT signing |
| `AUTH_URL` | Yes | Canonical public URL — `https://app.yeam.ai` |
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
> `AUTH_URL` does not match the domain you're browsing. Set it to `https://app.yeam.ai` in
> Vercel dashboard → Redeploy.

**DB connection error on first load**
> Verify `?sslmode=require` is appended to `DATABASE_URL` and migrations ran (Step 5).

**AI agents return stub responses**
> `GEMINI_API_KEY` is missing or invalid. Agents degrade gracefully — this is expected behavior.
