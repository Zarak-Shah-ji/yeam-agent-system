import { NextResponse } from 'next/server'
import { z } from 'zod'
import { format as formatDate } from 'date-fns'
import { prisma } from '@/lib/db'
import { requireOrg } from '@/lib/org'
import { loadPracticeNames } from '@/lib/practices/names'
import { searchWhere } from '@/lib/denials/search'
import { loadPayerMedians } from '@/lib/denials/payer-medians'
import {
  buildWorklistRow,
  compareWorklistRows,
  medianFor,
} from '@/lib/denials/worklist-row'
import { EXPORT_COLUMNS, exportRow, truncationRow } from '@/lib/denials/export'
import { DENIAL_STATUSES } from '@/lib/denials/status'
import { FACT_ROW_CAP } from '@/lib/insights/facts'
import { money } from '@/lib/money'

/**
 * The worklist as a file.
 *
 * A route handler rather than a client-side build, for one reason: only the
 * server has everything. The table holds the top slice by priority and pages
 * from there, so a browser that serialised what it had would produce a file that
 * silently stopped at whatever the biller happened to have scrolled past.
 *
 * Route handlers cannot go through tRPC, so they apply the org rule by hand —
 * requireOrg() and nothing else, exactly as app/api/imports/commit/route.ts
 * does. lib/org.ts states the rule: no org, no access to customer data, never a
 * fallback that reads everything.
 *
 * ── Why the filter is imported and not rewritten ─────────────────────────────
 *
 * `scope=view` has to mean the rows on screen. The moment this file grows its
 * own notion of what `q` matches, the promise in the menu ("Current view")
 * becomes a guess, and the way a customer discovers it is a file that disagrees
 * with the count above the table. searchWhere() is the same function the `rows`
 * procedure calls, buildWorklistRow() is the same builder, compareWorklistRows()
 * is the same order — so the file is the table, in the table's own sequence.
 */

const Params = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  /** The rows on screen, or the whole workspace. */
  scope: z.enum(['view', 'all']).default('view'),
  status: z.enum(DENIAL_STATUSES).optional(),
  q: z.string().max(120).optional(),
  batchId: z.string().optional(),
  /** Mirrors the `rows` input of the same name. '1' rather than 'true': it is a URL. */
  changedOnly: z.literal('1').optional(),
})

const CONTENT_TYPE = {
  // charset is not decoration here — see the BOM note below.
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

export async function GET(request: Request) {
  const org = await requireOrg()
  if (!org) {
    return NextResponse.json({ error: 'Sign in to export your worklist.' }, { status: 401 })
  }

  const parsed = Params.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) {
    return NextResponse.json({ error: 'That is not a worklist export.' }, { status: 400 })
  }
  const params = parsed.data
  const scoped = params.scope === 'view'

  const [rows, medians, seenAt, practiceNames] = await Promise.all([
    prisma.denialRow.findMany({
      where: {
        orgId: org.orgId,
        /*
          The practice scope applies to BOTH scopes, including "Everything".

          `scope=all` means ignore the FILTERS — the batch, the status, the
          search box, the things sitting in the toolbar above the table. The
          practice is not one of those. It is context: chosen in the sidebar,
          persisted across sessions, and announced by a permanent strip in the
          top bar that says which clinic you are looking at. A download that
          quietly crossed it would contradict that strip, and it would do so in
          a file that leaves the building.
        */
        ...org.practiceWhere,
        ...(scoped && params.batchId ? { batchId: params.batchId } : {}),
        ...(scoped && params.status ? { status: params.status } : {}),
        ...(scoped ? searchWhere(params.q) : {}),
      },
      // The same explicit select the `rows` procedure uses, and for the same
      // reason: this reads up to 50,000 records, so a column that comes back and
      // is never used is paid for fifty thousand times.
      select: {
        id: true,
        status: true,
        note: true,
        claimNumber: true,
        payer: true,
        carc: true,
        billed: true,
        denialDate: true,
        cpt: true,
        icd10: true,
        reason: true,
        lastTouchedAt: true,
        reconciledAt: true,
        followUpAt: true,
        practiceId: true,
      },
      take: FACT_ROW_CAP,
    }),
    // The same scope the rows above are read under, so the file and the table
    // cannot disagree about whether a payer is running late.
    loadPayerMedians(prisma, org.orgId, org.practiceWhere),
    /*
      When this person last marked the queue seen — only when the export is
      being asked to honour the "changed only" filter.

      Allowed to fail for the reason the same read in server/trpc/router/worklist.ts
      is allowed to fail: worklist_preferences is one of the migrations not yet
      applied to production, so a hard coupling here would 500 the export in
      every workspace until the backlog lands. A try/catch around the await
      rather than a .catch() on the promise, because a Prisma Client generated
      before the table existed has no delegate to return a promise at all.

      Falling back to null is not silently wrong: seenAt null means "nobody has
      marked this queue seen", which the filter below already treats as an empty
      changed set — the same answer the table gives.
    */
    (async () => {
      if (!params.changedOnly) return null
      try {
        const pref = await prisma.worklistPreference.findUnique({
          where: { orgId_userId: { orgId: org.orgId, userId: org.userId } },
          select: { worklistSeenAt: true },
        })
        return pref?.worklistSeenAt ?? null
      } catch (err) {
        console.error('worklist export: preference read failed, changed filter off', err)
        return null
      }
    })(),
    loadPracticeNames(prisma, org.orgId),
  ])

  const today = new Date()
  const built = rows
    .map(row =>
      buildWorklistRow(
        { ...row, billed: money(row.billed) },
        {
          today,
          payerMedianDaysToPay: medianFor(medians, row.payer),
          // Not exported, and not worth a query. The count is a per-page lookup
          // in `rows`; running it over the whole workspace would be a grouped
          // scan to fill a column the Status column already answers.
          draftCount: 0,
          practiceNames,
        },
      ),
    )
    .sort(compareWorklistRows)

  const visible =
    params.changedOnly && scoped
      ? built.filter(r => seenAt !== null && r.changedAt !== null && r.changedAt > seenAt)
      : built

  const records = visible.map(exportRow)
  // Measured against what came back from the database, not against what
  // survived the changed-only filter: the cap is a truth about the read.
  if (rows.length >= FACT_ROW_CAP) records.push(truncationRow())

  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.json_to_sheet(records, { header: [...EXPORT_COLUMNS] })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Worklist')

  const filename = `worklist-${formatDate(today, 'yyyy-MM-dd')}.${params.format}`

  const body =
    params.format === 'csv'
      ? // U+FEFF. Excel on Windows reads a BOM-less CSV as the system code page,
        // which turns the en dashes in a denial reason — and in the truncation
        // notice above — into mojibake. SheetJS does not write one.
        '﻿' + (XLSX.write(book, { bookType: 'csv', type: 'string' }) as string)
      : new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }) as Buffer)

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPE[params.format],
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Customer data behind a session cookie. Nothing between here and the
      // browser may keep a copy.
      'Cache-Control': 'no-store',
    },
  })
}
