import { SchemaType, type FunctionDeclaration } from '@google/generative-ai'

export const medicaidFunctionDeclarations: FunctionDeclaration[] = [
  {
    name: 'search_providers',
    description:
      'Search Texas Medicaid providers by name, NPI, city, zip, or credentials. Also use this to find TOP BILLERS in a city — pass city and sort_by="total_claims" or sort_by="total_paid". Returns each provider with totalClaims and totalPaid. Use when the user asks about a doctor, clinic, top billers, highest spenders, or wants to look up who billed what.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query:   { type: SchemaType.STRING, description: 'Provider name, organization name, or NPI to search' },
        city:    { type: SchemaType.STRING, description: 'City name to filter by (e.g. Houston, Dallas)' },
        zip:     { type: SchemaType.STRING, description: 'Zip code to filter by' },
        sort_by: { type: SchemaType.STRING, description: 'Sort results by: "total_claims" (default) or "total_paid"' },
        limit:   { type: SchemaType.NUMBER, description: 'Max results to return (default 10)' },
      },
    },
  },

  {
    name: 'get_provider_analytics',
    description:
      "Get detailed analytics for a specific Texas Medicaid provider by NPI — total claims, total paid, top procedures billed, monthly trends, and patient count. Use when the user asks about a provider's billing history or patterns.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        npi: { type: SchemaType.STRING, description: 'The 10-digit provider NPI number' },
      },
      required: ['npi'],
    },
  },

  {
    name: 'search_medicaid_claims',
    description:
      'Search aggregated Texas Medicaid claims by provider NPI, procedure code, and/or date range. Use when the user asks about claims data, billing codes, or statewide spending.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        npi:       { type: SchemaType.STRING, description: 'Provider NPI to filter by' },
        proc_code: { type: SchemaType.STRING, description: 'HCPCS/CPT procedure code (e.g. 99213)' },
        from_date: { type: SchemaType.STRING, description: 'Start year-month as YYYY-MM (e.g. 2023-01)' },
        to_date:   { type: SchemaType.STRING, description: 'End year-month as YYYY-MM (e.g. 2023-12)' },
        limit:     { type: SchemaType.NUMBER, description: 'Max results (default 20)' },
      },
    },
  },

  {
    name: 'get_procedure_info',
    description:
      'Get information about an HCPCS/CPT procedure code — description, average Texas Medicaid cost, and top providers. Use when the user mentions a procedure code or asks what it means or costs.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        code: { type: SchemaType.STRING, description: 'HCPCS or CPT procedure code (e.g. 99213, T1001)' },
      },
      required: ['code'],
    },
  },

  {
    name: 'detect_anomalies',
    description:
      'Detect billing anomalies for a Texas Medicaid provider — identifies cost outliers above the Texas average and monthly volume spikes. Use when the user asks about fraud indicators, unusual billing, or wants to audit a provider.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        npi: { type: SchemaType.STRING, description: 'Provider NPI to analyze for anomalies' },
      },
      required: ['npi'],
    },
  },

  {
    name: 'search_medicaid_patients',
    description:
      'Search Medicaid patient records by name, MRN, or assigned provider NPI. Use when the user asks to look up a Medicaid patient or retrieve patient records.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query:        { type: SchemaType.STRING, description: 'Patient first/last name or MRN (e.g. MRN-TX-000042)' },
        provider_npi: { type: SchemaType.STRING, description: 'Filter by primary provider NPI' },
        limit:        { type: SchemaType.NUMBER, description: 'Max results (default 10)' },
      },
    },
  },

  {
    name: 'get_patient_encounters',
    description:
      "Get encounter and claim history for a Medicaid patient. Use when the user asks about a patient's visit history, billing history, or claim statuses.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        patient_id:   { type: SchemaType.STRING, description: 'Medicaid patient UUID' },
        status:       { type: SchemaType.STRING, description: 'Filter by status: completed, scheduled, etc.' },
        claim_status: { type: SchemaType.STRING, description: 'Filter by claim status: clean, flagged, denied, paid' },
        limit:        { type: SchemaType.NUMBER, description: 'Max results (default 20)' },
      },
      required: ['patient_id'],
    },
  },

  {
    name: 'get_medicaid_dashboard',
    description:
      'Get high-level Texas Medicaid program statistics — total claims, total paid, total providers, total patients, denial rate, flagged claims. Use when the user asks for an overview or summary of the Medicaid program data.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        time_range: { type: SchemaType.STRING, description: 'Time range: last_30_days, last_90_days, ytd, or all (default: all)' },
      },
    },
  },
]
