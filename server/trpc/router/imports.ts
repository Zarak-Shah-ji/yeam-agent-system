import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, orgProcedure } from '../trpc'
import { money } from '@/lib/money'

/**
 * Managing what has been uploaded.
 *
 * Every query is scoped by ctx.orgId. Deletion matters more here than it looks:
 * a claims snapshot is the denominator for every rate in the product, so a
 * customer who uploads the wrong export needs to be able to take it back out
 * rather than live with poisoned charts.
 */
export const importsRouter = router({
  batches: orgProcedure
    .input(z.object({ kind: z.enum(['DENIALS', 'CLAIMS']).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const batches = await ctx.prisma.importBatch.findMany({
        where: { orgId: ctx.orgId, ...(input?.kind ? { kind: input.kind } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { _count: { select: { rows: true, claims: true } } },
      })

      // Only the newest claims batch is read by the insights layer; the rest are
      // superseded. Saying so beats a customer wondering why last month's export
      // is not in the totals.
      const newestClaims = batches.find(b => b.kind === 'CLAIMS')?.id ?? null

      return batches.map(b => ({
        id: b.id,
        kind: b.kind,
        filename: b.filename,
        rowCount: b.rowCount,
        droppedColumns: b.droppedColumns,
        statusDerived: b.statusDerived,
        createdAt: b.createdAt,
        denialRows: b._count.rows,
        claimRows: b._count.claims,
        active: b.kind === 'DENIALS' || b.id === newestClaims,
      }))
    }),

  /**
   * Remove an upload and everything it brought in.
   *
   * deleteMany, not delete: it takes orgId in the where clause, so a batch id
   * belonging to another workspace matches nothing instead of being deleted.
   * Rows, claims and drafts cascade from the schema.
   */
  deleteBatch: orgProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.importBatch.deleteMany({
        where: { id: input.batchId, orgId: ctx.orgId },
      })
      if (result.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { success: true }
    }),

  /**
   * Put the snapshot's denied claims onto the worklist.
   *
   * Explicit, never automatic. A customer who uploaded a denials export as well
   * already has these rows, so this skips any claim number already present and
   * reports how many it added.
   */
  addDeniedToWorklist: orgProcedure.mutation(async ({ ctx }) => {
    const batch = await ctx.prisma.importBatch.findFirst({
      where: { orgId: ctx.orgId, kind: 'CLAIMS' },
      orderBy: { createdAt: 'desc' },
    })
    if (!batch) throw new TRPCError({ code: 'NOT_FOUND', message: 'No claims export to read.' })

    const [denied, existing] = await Promise.all([
      ctx.prisma.orgClaim.findMany({
        where: { orgId: ctx.orgId, batchId: batch.id, status: 'DENIED' },
      }),
      ctx.prisma.denialRow.findMany({
        where: { orgId: ctx.orgId },
        select: { claimNumber: true },
      }),
    ])

    const known = new Set(existing.map(r => r.claimNumber).filter(Boolean))
    // A row with no reason code cannot be triaged, so it is not work.
    const toAdd = denied.filter(d => d.carc && (!d.claimNumber || !known.has(d.claimNumber)))
    if (toAdd.length === 0) return { added: 0 }

    // Its own DENIALS batch rather than hanging these off the claims snapshot.
    // Worklist queries filter on kind, and a batch is also the unit of undo — a
    // customer who regrets this should be able to remove exactly these rows
    // without taking the A/R snapshot with them.
    const created = await ctx.prisma.importBatch.create({
      data: {
        orgId: ctx.orgId,
        kind: 'DENIALS',
        filename: `Denied claims from ${batch.filename}`,
        rowCount: toAdd.length,
        droppedColumns: [],
        uploadedById: ctx.session.user?.id ?? null,
        rows: {
          create: toAdd.map(d => ({
            orgId: ctx.orgId,
            claimNumber: d.claimNumber,
            payer: d.payer,
            carc: d.carc as string,
            billed: money(d.billed),
            // Remit date where the export had one, service date as the fallback
            // — the same rule the denials parser uses.
            denialDate: d.remitDate ?? d.serviceDate,
            cpt: d.cpt,
            icd10: d.icd10,
            reason: null,
          })),
        },
      },
    })

    return { added: toAdd.length, batchId: created.id }
  }),
})
