import { NextResponse } from 'next/server'
import { requireOrg } from '@/lib/org'
import { prisma } from '@/lib/db'
import { readImportUpload } from '@/lib/imports/request'
import { ClaimsFileError, missingColumnsMessage, parseImport } from '@/lib/imports/service'
import { dropSamplePractice } from '@/lib/sample-practice'

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

    return NextResponse.json({
      batchId: batch.id,
      kind: parsed.kind,
      imported: parsed.rows.length,
      skipped: parsed.skipped,
      statusDerived: parsed.kind === 'claims' ? parsed.statusDerived : false,
      refusedColumns: preview.refusedColumns,
      unusedColumns: preview.unusedColumns,
    })
  } catch (err) {
    if (err instanceof ClaimsFileError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('import commit failed', err)
    return NextResponse.json({ error: 'Could not read that file.' }, { status: 500 })
  }
}
