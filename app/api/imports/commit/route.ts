import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/org'
import { prisma } from '@/lib/db'
import { readImportUpload } from '@/lib/imports/request'
import { MAX_IMPORT_ROWS } from '@/lib/imports/table'
import {
  ClaimsFileError,
  correctedProfileMessage,
  missingColumnsMessage,
  parseImport,
} from '@/lib/imports/service'
import { dropSamplePractice } from '@/lib/sample-practice'
import { reconcileOutcomes } from '@/lib/denials/reconcile'
import { money } from '@/lib/money'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Save an import into the workspace.
 *
 * Runs the same parse the preview ran, with the same overrides, so what the
 * customer confirmed is what lands. Only the fields each profile allowlists
 * survive — see lib/imports/deidentify.ts — so the identifiers in the file never
 * reach Postgres, and the response names the columns that were refused so the
 * customer can see that for themselves.
 *
 * A DENIALS batch accumulates work items. A CLAIMS batch is a snapshot; the
 * insights layer reads the most recent one rather than unioning them, which is
 * what stops two monthly exports double-counting every claim in both.
 */
/**
 * Close out appeals this snapshot has already answered.
 *
 * Runs on every CLAIMS commit. The alternative was a ledger filled in by hand,
 * which in practice means a ledger where the wins are recorded and the losses
 * are not — a dataset that is not thin but actively misleading.
 *
 * Deliberately not inside the batch transaction. A reconciliation that fails
 * must not lose the customer their import; the outcomes are recoverable on the
 * next upload, the snapshot is not.
 */
async function applyOutcomes(
  orgId: string,
  claims: readonly {
    claimNumber?: string | null
    status: string
    paid?: number | null
    remitDate?: Date | null
  }[],
): Promise<number> {
  const open = await prisma.denialSubmission.findMany({
    where: { orgId, outcome: 'PENDING' },
    select: {
      id: true,
      rowId: true,
      sentAt: true,
      row: { select: { claimNumber: true, billed: true } },
    },
  })
  if (open.length === 0) return 0

  const proposals = reconcileOutcomes({
    open: open.map(s => ({
      id: s.id,
      rowId: s.rowId,
      claimNumber: s.row.claimNumber,
      sentAt: s.sentAt,
      billed: money(s.row.billed),
    })),
    claims: claims.map(c => ({
      claimNumber: c.claimNumber ?? null,
      status: c.status,
      paid: c.paid ?? null,
      remitDate: c.remitDate ?? null,
    })),
  })
  if (proposals.length === 0) return 0

  const now = new Date()
  await prisma.$transaction(
    proposals.flatMap(p => [
      prisma.denialSubmission.updateMany({
        // outcome: PENDING in the where clause, not just the id: two imports
        // racing must not overwrite an outcome a biller typed in between them.
        // Theirs is the better evidence and it wins.
        where: { id: p.submissionId, orgId, outcome: 'PENDING' },
        data: {
          outcome: p.outcome,
          outcomeAt: p.outcomeAt,
          amountRecovered: p.amountRecovered,
          outcomeNote: p.note,
          outcomeSource: 'REMITTANCE',
          outcomeRecordedAt: now,
        },
      }),
      prisma.denialRow.updateMany({
        where: { id: p.rowId, orgId },
        data: { status: 'PAID', lastTouchedAt: now, followUpAt: null },
      }),
    ]),
  )

  return proposals.length
}

export async function POST(request: Request) {
  const org = await requireOrg()
  if (!org) {
    return NextResponse.json({ error: 'Sign in to save an import.' }, { status: 401 })
  }

  const read = await readImportUpload(request)
  if ('error' in read) return read.error

  try {
    const parsed = await parseImport(read.upload)
    const { preview } = parsed

    // The caller asked for one profile and detection confidently said another,
    // so parseImport corrected it. Saving now would write a batch of a kind the
    // page never showed — refuse until the customer has seen why. The client
    // re-previews, reads the banner, and sends confirmProfile with the retry.
    if (preview.profileSource === 'corrected' && !read.upload.confirmProfile) {
      return NextResponse.json(
        {
          error: correctedProfileMessage(preview),
          detectedProfile: preview.detectedProfile,
          requestedProfile: preview.requestedProfile,
          detectionEvidence: preview.detectionEvidence,
        },
        { status: 409 },
      )
    }

    if (preview.missing.length > 0) {
      return NextResponse.json({ error: missingColumnsMessage(preview) }, { status: 422 })
    }

    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            parsed.kind === 'denials'
              ? 'No rows in that file carried a reason code, so there is nothing to triage.'
              : 'No rows in that file carried an amount or a date, so there is nothing to measure.',
        },
        { status: 422 },
      )
    }

    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      // Deliberately not phrased as an upgrade wall. A book this size is a
      // billing company rather than a single practice, and that is a
      // conversation to have, not a checkout button to show.
      return NextResponse.json(
        {
          error: `That file carries ${parsed.rows.length.toLocaleString()} usable rows, and a self-serve workspace takes ${MAX_IMPORT_ROWS.toLocaleString()} per upload. Split it by date range, or get in touch and we will set the workspace up for the whole book.`,
        },
        { status: 413 },
      )
    }

    // A real file supersedes the sample practice outright. Leaving it in place
    // would put seeded rows in the same totals as the customer's own denials,
    // which is the confusion the old /demo split existed to prevent.
    await dropSamplePractice(prisma, org.orgId)

    const batch = await prisma.importBatch.create({
      data: {
        orgId: org.orgId,
        kind: parsed.kind === 'claims' ? 'CLAIMS' : 'DENIALS',
        filename: preview.filename,
        rowCount: parsed.rows.length,
        droppedColumns: preview.refusedColumns,
        statusDerived: parsed.kind === 'claims' ? parsed.statusDerived : false,
        uploadedById: org.userId,
        ...(parsed.kind === 'claims'
          ? {
              claims: {
                create: parsed.rows.map(row => ({
                  orgId: org.orgId,
                  claimNumber: row.claimNumber ?? null,
                  payer: row.payer ?? null,
                  status: row.status,
                  billed: row.billed,
                  allowed: row.allowed ?? null,
                  paid: row.paid ?? null,
                  patientResp: row.patientResp ?? null,
                  adjustment: row.adjustment ?? null,
                  serviceDate: row.serviceDate,
                  submittedDate: row.submittedDate,
                  remitDate: row.remitDate,
                  cpt: row.cpt ?? null,
                  icd10: row.icd10 ?? null,
                  carc: row.carc ?? null,
                })),
              },
            }
          : {
              rows: {
                create: parsed.rows.map(row => ({
                  orgId: org.orgId,
                  claimNumber: row.claimNumber ?? null,
                  payer: row.payer ?? null,
                  carc: row.carc,
                  billed: row.billed,
                  denialDate: row.denialDate,
                  cpt: row.cpt ?? null,
                  icd10: row.icd10 ?? null,
                  reason: row.reason ?? null,
                })),
              },
            }),
      },
    })

    // An A/R export answers appeals nobody has closed out yet. See
    // lib/denials/reconcile.ts for why this only ever books wins.
    const resolved = parsed.kind === 'claims' ? await applyOutcomes(org.orgId, parsed.rows) : 0

    return NextResponse.json({
      batchId: batch.id,
      kind: parsed.kind,
      imported: parsed.rows.length,
      // Appeals this upload closed out on its own. Reported so the summary can
      // say so — an outcome written silently is one the biller cannot check.
      outcomesResolved: resolved,
      skipped: parsed.skipped,
      statusDerived: parsed.kind === 'claims' ? parsed.statusDerived : false,
      refusedColumns: preview.refusedColumns,
      unusedColumns: preview.unusedColumns,
      // So the import summary can offer these as worklist items straight away,
      // rather than leaving them to a banner on a page the customer may not open.
      deniedWithCarc: preview.deniedWithCarc,
    })
  } catch (err) {
    if (err instanceof ClaimsFileError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('import commit failed', err)
    return NextResponse.json({ error: 'Could not read that file.' }, { status: 500 })
  }
}
