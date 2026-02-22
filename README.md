# Yeam.ai — AI-Powered EHR System

A full-stack Electronic Health Record (EHR) system for Molina Family Health Clinic, built with Next.js 16, tRPC, Prisma, and Google Gemini AI agents.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL + Prisma v6 |
| Auth | NextAuth v5 (credentials provider) |
| API | tRPC v11 + React Query v5 |
| AI | Google Gemini 2.5 Flash (via `@google/generative-ai`) |
| Package manager | pnpm |

## Features

### Clinical Workflow
- **Patient management** — searchable patient table with demographics, MRN, insurance, and full detail view
- **Appointments** — daily schedule with date/status filters, one-click check-in, and cancellation flow (reason dropdown, grayed-out rows, DB audit trail)
- **Encounters** — SOAP note editor (Subjective / Objective / Assessment / Plan) with AI Assist
- **Claims** — claim status tracking, denial management, and AI-generated appeal letters
- **Analytics** — revenue chart, denial rate trend, top diagnoses, and natural-language query box

### AI Agent System
Five specialized agents routed via Gemini intent classification:

| Agent | Handles |
|---|---|
| **Front Desk** | Check-ins, scheduling, cancellations, patient lookup, insurance verification |
| **Clinical Doc** | SOAP notes, encounter documentation, ICD-10/CPT coding |
| **Claim Scrubber** | Claim validation, code review, status checks |
| **Billing** | Denied claims, appeal letters, revenue cycle |
| **Analytics** | Denial rates, revenue metrics, trend analysis |

The **Command Bar** (⌘K) routes natural-language queries to the correct agent, executes live database lookups via Gemini function calling, and streams responses back in a persistent chat panel.

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm
- PostgreSQL

### Setup

```bash
# Install dependencies
pnpm install

# Create the database
createdb yeam_dev

# Copy environment variables
cp .env.example .env
# Fill in DATABASE_URL, AUTH_SECRET, and GEMINI_API_KEY

# Run migrations
pnpm prisma migrate dev

# Seed demo data
pnpm prisma db seed

# Start dev server
pnpm dev
```



### Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | NextAuth secret (generate with `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | App URL (e.g. `http://localhost:3000`) |
| `GEMINI_API_KEY` | Google AI Studio API key |

### Demo Credentials

| Role | Email | Password |
|---|---|---|
| Admin | admin@molinaclinic.demo | demo1234 |
| Provider | provider@molinaclinic.demo | demo1234 |
| Front Desk | frontdesk@molinaclinic.demo | demo1234 |
| Billing | billing@molinaclinic.demo | demo1234 |

## Project Structure

```
app/
  (auth)/login/         # Login page
  (dashboard)/          # Protected dashboard pages
    patients/           # Patient list + detail
    appointments/       # Daily schedule
    encounters/         # SOAP note editor
    claims/             # Claims management
    billing/            # Denial management + appeals
    analytics/          # Charts + NL queries
  api/
    agents/
      stream/           # Legacy SSE agent stream
      chat/             # Gemini orchestrator (intent → function calling → stream)
    trpc/               # tRPC handler

components/
  appointments/         # AppointmentsView, CancelAppointmentDialog
  layout/               # Sidebar, Header, CommandBar, AgentActivityFeed
  ui/                   # Shared UI primitives (shadcn-style)

lib/
  agents/               # Agent classes + Gemini client + orchestrator
  auth.ts               # NextAuth config
  db.ts                 # Prisma singleton

server/trpc/router/     # tRPC routers (dashboard, patients, appointments, encounters, claims, analytics)
prisma/
  schema.prisma         # 11 domain tables + NextAuth tables
  seed.ts               # Demo data (4 users, 3 providers, 5 payers, 20 patients, 30 appts)
```

## Key Design Decisions

- **`proxy.ts`** (not `middleware.ts`) — Next.js 16 renamed the middleware entrypoint
- **`AUTH_SECRET`** (not `NEXTAUTH_SECRET`) — NextAuth v5 convention
- Prisma `Decimal` fields call `.toNumber()` before returning from tRPC
- Agent logs are written fire-and-forget to avoid blocking the SSE stream
- Gemini function calling: Flash classifies intent, Flash executes with tools + conversation history
