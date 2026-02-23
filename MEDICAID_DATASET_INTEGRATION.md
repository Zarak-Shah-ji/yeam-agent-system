# Medicaid Dataset Integration — Claude Code Prompt

## BEFORE YOU DO ANYTHING

1. **Read this entire file first** (`MEDICAID_DATA_INTEGRATION_PROMPT.md`) top to bottom before writing any code or making any changes.
2. **Then read the existing codebase** — check `package.json`, `prisma/schema.prisma` (or equivalent ORM config), `app/` directory structure, `lib/`, and any existing database config. Understand the existing patterns before adding anything.
3. **Then inspect the dataset** — run `head -5 state_TX.csv` and `wc -l state_TX.csv` to understand the actual data.
4. **Only then** start implementing, following the phases below in order.

---

## Context

You are working on **Yeam.ai** (`yeam_agent_system`), an AI-powered EHR system that uses a conversational, agent-driven approach to replace traditional click-heavy EHR interfaces. The primary value proposition is **preventing rejected medical claims** for small/medium healthcare clinics by reducing denial rates from 5-10% down to ~2%.

The system uses **Next.js** (App Router) + **PostgreSQL** + **Gemini Pro API**.

There is a file called `state_TX.csv` in the project root. This is **real Medicaid provider spending data for Texas** from the DOGE/HHS open data release (February 2026). It contains ~millions of rows of aggregated, provider-level claims data from T-MSIS covering 2018-2024.

---

## Dataset Schema — `state_TX.csv`

The CSV has **34 columns**. Here is the exact layout:

| Column | Description |
|---|---|
| `billing_state` | Location state of the billing provider |
| `billing_npi` | Billing provider NPI (National Provider Identifier) |
| `servicing_npi` | Servicing provider NPI |
| `proc_code` | HCPCS procedure code |
| `yrmonth` | Year-month of date of service (e.g., 202301) |
| `num_benes` | Number of Medicaid beneficiaries |
| `num_claims` | Number of claims |
| `paid_amt` | Total paid amount |
| `ao_fname` | Authorized official first name |
| `ao_mname` | Authorized official middle name |
| `ao_lname` | Authorized official last name |
| `billing_org_name` | Billing provider organization name |
| `billing_fname` | Billing provider first name |
| `billing_mname` | Billing provider middle name |
| `billing_lname` | Billing provider last name |
| `billing_credentials` | Billing provider credentials (e.g., MD, DO, NP) |
| `billing_orgname_other` | Billing provider other/alternate name |
| `billing_addr1` | Billing provider street address 1 |
| `billing_addr2` | Billing provider street address 2 |
| `billing_city` | Billing provider city |
| `billing_state` | Billing provider state (duplicate col name — second instance) |
| `billing_zip` | Billing provider zip code |
| `servicing_org_name` | Servicing provider organization name |
| `servicing_fname` | Servicing provider first name |
| `servicing_mname` | Servicing provider middle name |
| `servicing_lname` | Servicing provider last name |
| `servicing_credentials` | Servicing provider credentials |
| `servicing_orgname_other` | Servicing provider other/alternate name |
| `servicing_addr1` | Servicing provider street address 1 |
| `servicing_addr2` | Servicing provider street address 2 |
| `servicing_city` | Servicing provider city |
| `servicing_state` | Servicing provider state |
| `servicing_zip` | Servicing provider zip code |

---

## What You Need To Do

### PHASE 1: Data Ingestion & Database Schema

1. **Inspect the CSV first.** Run `head -5 state_TX.csv` and `wc -l state_TX.csv` to understand the actual data shape, check for header rows, null patterns, and row count.

2. **Create a Prisma migration** (or raw SQL if the project doesn't use Prisma yet) with the following tables. Adapt these to fit any existing schema patterns in the project:

#### Table: `medicaid_providers`
Extract unique providers from the CSV. Deduplicate on NPI.

```
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
npi             VARCHAR(10) UNIQUE NOT NULL — the NPI number
org_name        TEXT — organization name (billing_org_name or servicing_org_name)
first_name      TEXT
middle_name     TEXT
last_name       TEXT
credentials     TEXT — MD, DO, NP, etc.
org_name_other  TEXT
addr_line1      TEXT
addr_line2      TEXT
city            TEXT
state           VARCHAR(2)
zip             VARCHAR(10)
provider_type   TEXT — derived later from most-used proc_codes if possible
created_at      TIMESTAMPTZ DEFAULT NOW()
updated_at      TIMESTAMPTZ DEFAULT NOW()
```

#### Table: `medicaid_claims_agg`
The raw aggregated claims data. One row per (billing_npi, servicing_npi, proc_code, yrmonth) combination.

```
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
billing_npi         VARCHAR(10) NOT NULL — FK to medicaid_providers.npi
servicing_npi       VARCHAR(10) — FK to medicaid_providers.npi
proc_code           VARCHAR(10) NOT NULL — HCPCS code
year_month          VARCHAR(6) NOT NULL — e.g., "202301"
num_beneficiaries   INTEGER
num_claims          INTEGER
paid_amount         DECIMAL(12,2)
ao_first_name       TEXT — authorized official
ao_middle_name      TEXT
ao_last_name        TEXT
created_at          TIMESTAMPTZ DEFAULT NOW()
```

Add indexes on: `billing_npi`, `servicing_npi`, `proc_code`, `year_month`, and a composite index on `(billing_npi, proc_code, year_month)`.

#### Table: `patients`
Generate synthetic but realistic patient records derived FROM the Medicaid data. For each unique (billing_npi, servicing_npi) pair that has claims, generate synthetic patients. This makes the data usable for the EHR workflow.

```
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
mrn                 VARCHAR(20) UNIQUE NOT NULL — medical record number, auto-generated (e.g., "MRN-TX-000001")
first_name          TEXT NOT NULL — synthetic, generated
last_name           TEXT NOT NULL — synthetic, generated
date_of_birth       DATE NOT NULL — synthetic, random realistic age 0-95
gender              VARCHAR(10) — synthetic
phone               VARCHAR(15) — synthetic
email               TEXT — synthetic
address_line1       TEXT — can reuse provider city/zip for geographic realism
city                TEXT
state               VARCHAR(2) DEFAULT 'TX'
zip                 VARCHAR(10)
insurance_type      VARCHAR(20) DEFAULT 'Medicaid'
insurance_id        VARCHAR(30) — synthetic Medicaid ID
insurance_status    VARCHAR(10) DEFAULT 'active' — active/inactive/pending
primary_provider_npi VARCHAR(10) — FK to medicaid_providers.npi (the billing provider)
created_at          TIMESTAMPTZ DEFAULT NOW()
updated_at          TIMESTAMPTZ DEFAULT NOW()
```

#### Table: `encounters`
Generate synthetic encounters tied to real claims data. Each row in `medicaid_claims_agg` can map to synthetic encounters.

```
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
patient_id          UUID NOT NULL — FK to patients.id
provider_npi        VARCHAR(10) NOT NULL — FK to medicaid_providers.npi (servicing)
billing_npi         VARCHAR(10) — FK to medicaid_providers.npi (billing)
encounter_date      DATE NOT NULL — derived from year_month + random day
proc_code           VARCHAR(10) NOT NULL — HCPCS code from the claims data
diagnosis_codes     TEXT[] — synthetic but realistic ICD-10 codes mapped to the proc_code
status              VARCHAR(20) DEFAULT 'completed' — scheduled/checked-in/in-progress/completed/billed/denied
claim_status        VARCHAR(20) DEFAULT 'clean' — clean/flagged/denied/resubmitted/paid
paid_amount         DECIMAL(12,2) — from the real data
notes               TEXT — synthetic clinical note
created_at          TIMESTAMPTZ DEFAULT NOW()
updated_at          TIMESTAMPTZ DEFAULT NOW()
```

#### Table: `hcpcs_codes` (reference table)
Build a reference lookup for procedure codes found in the data.

```
id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
code        VARCHAR(10) UNIQUE NOT NULL
description TEXT — look up from a public HCPCS reference or hardcode top 200 common ones
category    TEXT — E/M, surgical, diagnostic, etc.
avg_cost_tx DECIMAL(10,2) — calculated from the TX data (AVG of paid_amount / num_claims)
```

### PHASE 2: Data Loading Script

Create a script at `scripts/load-medicaid-data.ts` (or `.js`) that:

1. **Reads `state_TX.csv`** using a streaming CSV parser (e.g., `csv-parse` or `papaparse`) — do NOT load the entire file into memory at once since it could be millions of rows.

2. **Extracts unique providers** from both billing and servicing columns, deduplicates on NPI, and bulk-inserts into `medicaid_providers` using `ON CONFLICT (npi) DO NOTHING`.

3. **Loads aggregated claims** into `medicaid_claims_agg` in batches of 5,000-10,000 rows.

4. **Generates synthetic patients.** For each of the top ~500 most active billing providers (by total claim count), generate 5-20 synthetic patients each. Use a library like `@faker-js/faker` for realistic names, DOBs, phone numbers. Assign them to the provider's city/zip. Total target: ~5,000-10,000 synthetic patients.

5. **Generates synthetic encounters.** For each patient, sample from their assigned provider's real proc_codes and create 3-10 encounters spread across the date range of the data. Map each proc_code to a realistic ICD-10 diagnosis code (create a mapping object for at least the top 50 most common HCPCS codes in the data → plausible ICD-10 codes). Set ~8% of encounters to `claim_status: 'denied'` and ~5% to `claim_status: 'flagged'` to simulate realistic denial rates.

6. **Populates `hcpcs_codes`** by aggregating the distinct proc_codes from the claims data and calculating average cost per claim per code from the TX data.

7. **Logs progress** — print how many providers, claims, patients, and encounters were created.

8. Add a `package.json` script: `"db:seed-medicaid": "tsx scripts/load-medicaid-data.ts"`

### PHASE 3: API Layer for the AI Agents

Create API routes that expose this data to both the frontend and the Gemini Pro LLM. These go under `app/api/` (Next.js App Router convention).

#### `app/api/medicaid/providers/route.ts`
- `GET /api/medicaid/providers` — search providers by name, NPI, city, zip, credentials
- Query params: `?q=smith&city=houston&zip=77001&limit=20&offset=0`
- Returns: provider info with summary stats (total claims, total paid, active patients count)

#### `app/api/medicaid/claims/route.ts`
- `GET /api/medicaid/claims` — query aggregated claims
- Query params: `?npi=1234567890&proc_code=99213&from=202301&to=202312&limit=50`
- Returns: claims with provider names joined

#### `app/api/medicaid/analytics/route.ts`
- `GET /api/medicaid/analytics/provider-summary?npi=1234567890` — per-provider analytics
  - Total claims, total paid, unique patients, top proc codes, monthly trend, average paid per claim
- `GET /api/medicaid/analytics/proc-code-summary?code=99213` — per-procedure analytics
  - Total claims across all providers, average cost, top providers using this code
- `GET /api/medicaid/analytics/anomalies?npi=1234567890` — flag anomalous billing patterns
  - Providers billing significantly above average for a given code
  - Sudden spikes in claim volume
  - Unusual proc_code combinations

#### `app/api/patients/route.ts`
- `GET /api/patients` — search patients by name, MRN, provider
- `GET /api/patients/[id]` — full patient detail with encounters list
- `POST /api/patients` — create new patient (for front desk agent)

#### `app/api/encounters/route.ts`
- `GET /api/encounters` — list encounters with filters (patient, provider, date range, status, claim_status)
- `GET /api/encounters/[id]` — full encounter detail
- `POST /api/encounters` — create new encounter
- `PATCH /api/encounters/[id]` — update status, claim_status, etc.

### PHASE 4: LLM Integration — Give the AI Access to This Data

This is the critical part. The Gemini Pro API (or whatever LLM is configured) needs to be able to **query this data contextually** when users ask questions through the command bar.

#### Option A: Function Calling / Tool Use (Preferred)

Define tools that the LLM can call. Create a file `lib/ai/medicaid-tools.ts`:

```typescript
export const medicaidTools = [
  {
    name: "search_providers",
    description: "Search Medicaid providers by name, NPI, city, zip, or credentials. Use this when the user asks about a doctor, clinic, provider, or wants to look up who billed what.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Provider name or NPI to search" },
        city: { type: "string", description: "City to filter by" },
        zip: { type: "string", description: "Zip code to filter by" },
        limit: { type: "number", description: "Max results to return", default: 10 }
      }
    }
  },
  {
    name: "get_provider_analytics",
    description: "Get detailed analytics for a specific provider by NPI — total claims, spending, top procedures, trends over time. Use when user asks about a provider's billing history or patterns.",
    parameters: {
      type: "object",
      properties: {
        npi: { type: "string", description: "Provider NPI number" }
      },
      required: ["npi"]
    }
  },
  {
    name: "search_claims",
    description: "Search Medicaid claims by provider NPI, procedure code, date range. Use when user asks about claims, billing codes, or spending.",
    parameters: {
      type: "object",
      properties: {
        npi: { type: "string", description: "Provider NPI" },
        proc_code: { type: "string", description: "HCPCS procedure code" },
        from_date: { type: "string", description: "Start year-month (YYYYMM)" },
        to_date: { type: "string", description: "End year-month (YYYYMM)" },
        limit: { type: "number", default: 20 }
      }
    }
  },
  {
    name: "get_procedure_info",
    description: "Get information about an HCPCS procedure code — description, average cost in Texas, top providers. Use when user mentions a CPT/HCPCS code or asks what a procedure code means.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "HCPCS/CPT procedure code" }
      },
      required: ["code"]
    }
  },
  {
    name: "detect_anomalies",
    description: "Detect billing anomalies for a provider — unusually high volumes, cost outliers, suspicious patterns. Use when user asks about fraud detection, unusual billing, or claim scrubbing.",
    parameters: {
      type: "object",
      properties: {
        npi: { type: "string", description: "Provider NPI to analyze" }
      },
      required: ["npi"]
    }
  },
  {
    name: "search_patients",
    description: "Search patients by name, MRN, or provider. Use when the user asks about a patient, wants to look up patient records, or check in a patient.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Patient name or MRN" },
        provider_npi: { type: "string", description: "Filter by primary provider NPI" },
        limit: { type: "number", default: 10 }
      }
    }
  },
  {
    name: "get_patient_encounters",
    description: "Get encounter history for a patient. Use when user asks about patient visits, medical history, or claim history.",
    parameters: {
      type: "object",
      properties: {
        patient_id: { type: "string", description: "Patient UUID" },
        status: { type: "string", description: "Filter by encounter status" },
        claim_status: { type: "string", description: "Filter by claim status (clean/flagged/denied/paid)" }
      },
      required: ["patient_id"]
    }
  },
  {
    name: "get_dashboard_stats",
    description: "Get high-level dashboard stats — total claims processed, denial rate, total paid, active patients, flagged claims. Use when user opens the dashboard or asks for an overview.",
    parameters: {
      type: "object",
      properties: {
        time_range: { type: "string", description: "Time range like 'last_30_days', 'last_90_days', 'ytd', 'all'" }
      }
    }
  }
];
```

#### Tool Execution Handler

Create `lib/ai/tool-executor.ts` that takes a tool call from the LLM and executes the corresponding database query via the API routes (or direct Prisma/SQL calls). Return the results as a JSON string back to the LLM for it to formulate a natural language response.

#### Wire Into Existing Chat/Command Bar

Find the existing command bar or chat component in the system. When the user types a query:

1. Send the user message + tool definitions to Gemini Pro
2. If Gemini returns a tool call, execute it via the tool executor
3. Send the tool result back to Gemini
4. Gemini formulates a natural language answer using the real data
5. Display the response in the command bar / chat UI

Example user queries the system should handle after integration:

- "Show me the top 10 providers in Houston by total Medicaid billing"
- "What's the average cost for procedure code 99213 in Texas?"
- "Look up NPI 1234567890 — what do they primarily bill for?"
- "Check in patient Maria Santos"
- "Show me all denied claims from last month"
- "Which providers have unusual billing spikes in 2024?"
- "What's our current denial rate?"
- "Pull up encounter history for MRN-TX-000042"

#### Option B: Context Injection (Simpler Fallback)

If function calling isn't working well with the current Gemini integration, create a simpler `lib/ai/build-context.ts` that:

1. Takes the user's query
2. Runs relevant SQL queries to pull data context
3. Injects the results as a system message before the user's query
4. Sends to Gemini as a single prompt with data context

---

## PHASE 5: Validation & Testing

After everything is built:

1. Run the seed script and verify row counts:
   - `SELECT COUNT(*) FROM medicaid_providers;` — should be thousands
   - `SELECT COUNT(*) FROM medicaid_claims_agg;` — should be hundreds of thousands to millions
   - `SELECT COUNT(*) FROM patients;` — should be 5,000-10,000
   - `SELECT COUNT(*) FROM encounters;` — should be 30,000-100,000
   - `SELECT COUNT(*) FROM hcpcs_codes;` — should be hundreds

2. Test API routes with curl:
   ```bash
   curl "http://localhost:3000/api/medicaid/providers?q=houston&limit=5"
   curl "http://localhost:3000/api/medicaid/analytics/provider-summary?npi=<some_real_npi_from_data>"
   curl "http://localhost:3000/api/patients?q=smith&limit=5"
   ```

3. Test LLM tool calling by asking the command bar:
   - "Who are the top billers in Dallas?"
   - "What does procedure code 99213 cost on average?"
   - "Show me my denied claims"

---

## Important Notes

- **Do NOT load the entire CSV into memory.** Use streaming. The file could be 500MB+.
- **Batch all inserts.** Use bulk INSERT with ON CONFLICT for idempotency.
- **The proc_code column contains HCPCS codes**, which are a superset of CPT codes. The system should treat them interchangeably in the UI.
- **The `yrmonth` field** is a string like "202301". Parse it for date math but store as-is for simplicity.
- **Synthetic data should feel real.** Use proper Texas city names from the providers' actual locations, realistic age distributions, and proper Medicaid ID formats.
- **The 5 Yeam agents** (Front Desk, Clinical Documentation, Claim Scrubbing, Billing, Analytics) should all benefit from this data. The Front Desk agent uses patients/encounters for check-in. The Claim Scrubbing agent uses claims data + HCPCS codes to validate. The Analytics agent uses the aggregate data for dashboards and anomaly detection. The Billing agent uses encounters and claim statuses.
- **Preserve the existing system.** Don't break any existing functionality. This is additive — new tables, new API routes, new tool definitions.
- **Match existing codebase patterns.** Adapt your approach to whatever ORM, naming conventions, and file structure already exist in the project.