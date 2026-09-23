import { SchemaType, type FunctionDeclarationsTool } from '@google/generative-ai'
import type { PrismaClient } from '@prisma/client'
import type { PracticeWhere } from '@/lib/practices/scope'
import { loadFacts } from '@/lib/insights/facts'
import { overview, payerScorecard, topCarcs, payerOf } from '@/lib/insights/aggregate'
import { triageRow, type ClaimRow } from '@/lib/denials/triage'
import { matchesSearch, normalizeQuery } from '@/lib/denials/search'
import { scoreRow } from '@/lib/denials/score'

/**
 * What the assistant is allowed to know.
 *
 * The previous tool surface was about forty functions over the seeded EHR and
 * the statewide Texas Medicaid dataset, and not one of them filtered by
 * organization — the model could be asked for another customer's patients and
 * would answer. One of them could cancel an appointment. That is a worse leak
 * than an unscoped route, because the query is chosen at runtime by a model
 * responding to text a user typed.
 *
 * The rules here are deliberately narrow, and they are the contract:
 *   1. Every tool takes an orgId the caller resolved from the session. There is
 *      no tool that reads across organizations and no way to ask for one.
 *   2. Nothing writes. A chat turn cannot change a customer's data.
 *   3. Answers come from lib/insights/aggregate.ts — the same pure functions
 *      /analytics renders — so the assistant and the dashboard can never
 *      disagree about the denial rate.
 *
 * Adding a tool means honouring all three. A tool that takes an identifier from
 * the model instead of from the session is the bug this file exists to prevent.
 */

const MAX_ROWS = 25

export const workspaceTools: FunctionDeclarationsTool[] = [
  {
    functionDeclarations: [
      {
        name: 'workspace_overview',
        description:
          'Headline numbers for the signed-in workspace: billed, paid and outstanding from the ' +
          'most recent claims snapshot, plus open denials, amount at stake, amount expiring soon ' +
          'and amount recovered. Call this for any question about totals, denial rate or ' +
          'collection rate.',
        parameters: { type: SchemaType.OBJECT, properties: {} },
      },
      {
        name: 'top_denial_reasons',
        description:
          'The workspace\'s denial reasons ranked by money, each with its CARC code, what the ' +
          'code means, the remedy that applies and how much of it is still recoverable. Call ' +
          'this for "why are we being denied", "biggest denial reasons", or any CARC question.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            limit: {
              type: SchemaType.NUMBER,
              description: `How many reasons to return. Default 10, max ${MAX_ROWS}.`,
            },
          },
        },
      },
      {
        name: 'worklist_rows',
        description:
          'Individual denials from the worklist, highest priority first — the same ordering the ' +
          'Worklist page uses, mixing filing deadline, dollars at stake and how long a row has ' +
          'gone untouched. Rows are de-identified: there is no patient name, member ID or date ' +
          'of birth to return. Call this for "what should I work on", "what expires soon", or ' +
          'questions about a specific payer.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            payer: {
              type: SchemaType.STRING,
              description: 'Optional. Only rows for this payer name.',
            },
            search: {
              type: SchemaType.STRING,
              description:
                'Optional. Free text matched against the claim number, payer, CARC code, CPT, ' +
                'ICD-10 and denial reason. Use it when the user names a specific claim or code ' +
                'rather than asking for a ranking. A search also looks at settled rows, so a ' +
                'claim that was already paid or written off is still found.',
            },
            limit: {
              type: SchemaType.NUMBER,
              description: `How many rows to return. Default 10, max ${MAX_ROWS}.`,
            },
          },
        },
      },
    ],
  },
]

const TOOL_NAMES = new Set(
  workspaceTools.flatMap(t => t.functionDeclarations ?? []).map(d => d.name),
)

export function isWorkspaceTool(name: string): boolean {
  return TOOL_NAMES.has(name)
}

function clampLimit(raw: unknown, fallback = 10): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), MAX_ROWS)
}

/**
 * Run one tool call against one workspace.
 *
 * `orgId` comes from the caller's session, never from `args` — see the header.
 * So does `practiceWhere`, and for the same reason: the model must not be able
 * to widen its own view by asking about a clinic. It answers about what the
 * biller is looking at, so that "how many open denials do we have" agrees with
 * the number on the tile beside the chat.
 */
export async function executeWorkspaceTool(
  prisma: PrismaClient,
  orgId: string,
  name: string,
  args: Record<string, unknown>,
  practiceWhere: PracticeWhere = {},
): Promise<Record<string, unknown>> {
  const today = new Date()

  switch (name) {
    case 'workspace_overview': {
      const { claims, denials, statusDerived, batch, truncated } = await loadFacts(prisma, orgId, practiceWhere)
      return {
        ...overview(claims, denials, today, { statusDerived }),
        snapshotFilename: batch?.filename ?? null,
        snapshotAt: batch?.createdAt ?? null,
        // Say so rather than letting the model present a floor as a total.
        partial: truncated,
      }
    }

    case 'top_denial_reasons': {
      const { denials } = await loadFacts(prisma, orgId, practiceWhere)
      if (denials.length === 0) {
        return { reasons: [], note: 'This workspace has no denials imported yet.' }
      }
      return { reasons: topCarcs(denials, today, clampLimit(args.limit)) }
    }

    case 'worklist_rows': {
      const { denials, claims } = await loadFacts(prisma, orgId, practiceWhere)

      const wanted = typeof args.payer === 'string' ? payerOf(args.payer).toLowerCase() : null
      const byPayer = wanted
        ? denials.filter(d => payerOf(d.payer).toLowerCase() === wanted)
        : denials

      // The same match the Worklist search box runs, so the assistant and the
      // table can never disagree about whether a claim number exists.
      const search = normalizeQuery(typeof args.search === 'string' ? args.search : null)
      const candidates = search ? byPayer.filter(d => matchesSearch(d, search)) : byPayer

      // Ranking questions are about what is left to do, so settled rows are
      // noise. Looking a claim up is the opposite: "we already wrote that one
      // off" is the answer, and hiding the row would have the assistant report
      // it as missing instead.
      const open = search
        ? candidates
        : candidates.filter(d => d.status !== 'PAID' && d.status !== 'DEAD')

      const scored = open.map(denial => {
        const base = triageRow(denial as ClaimRow, today)
        const { score, band } = scoreRow(
          {
            billed: base.billed,
            daysLeft: base.daysLeft,
            actionable: base.actionable,
            remedy: base.remedy,
            denialDate: denial.denialDate,
            // The chat surface reads facts; it has no access to the human-owned
            // columns, so it must not imply anything about them either way.
            lastTouchedAt: null,
            followUpAt: null,
          },
          today,
        )
        return {
          claimNumber: denial.claimNumber ?? null,
          payer: payerOf(denial.payer),
          status: denial.status,
          carc: base.carc,
          reason: base.carcLabel,
          billed: base.billed,
          remedy: base.remedyLabel,
          daysLeft: base.daysLeft,
          expired: base.expired,
          actionable: base.actionable,
          band,
          score,
        }
      })

      scored.sort((a, b) => b.score - a.score)

      return {
        rows: scored.slice(0, clampLimit(args.limit)),
        // Named for what it counts: everything the filters left, which is every
        // open row when nothing was searched for and every match when it was.
        totalMatched: open.length,
        searchedFor: search || undefined,
        // Present so the model can answer "who is worst" without a second call.
        payers: wanted ? undefined : payerScorecard(claims, denials, today).slice(0, 5),
      }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}
