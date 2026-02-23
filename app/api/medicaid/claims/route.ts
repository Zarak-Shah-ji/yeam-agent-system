import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/medicaid/claims?npi=1234567890&proc_code=99213&from=2023-01&to=2023-12&limit=50&offset=0
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const npi       = searchParams.get('npi')?.trim()
  const procCode  = searchParams.get('proc_code')?.trim()
  const from      = searchParams.get('from')?.trim()
  const to        = searchParams.get('to')?.trim()
  const limit     = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)
  const offset    = parseInt(searchParams.get('offset') ?? '0')

  const where: Prisma.MedicaidClaimsAggWhereInput = {}
  if (npi)      where.billingNpi = npi
  if (procCode) where.procCode   = procCode
  if (from || to) {
    where.yearMonth = {
      ...(from ? { gte: from } : {}),
      ...(to   ? { lte: to   } : {}),
    }
  }

  const [claims, total] = await Promise.all([
    prisma.medicaidClaimsAgg.findMany({
      where,
      include: {
        billingProvider:   { select: { orgName: true, firstName: true, lastName: true, city: true, state: true } },
        servicingProvider: { select: { orgName: true, firstName: true, lastName: true } },
      },
      orderBy: { yearMonth: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.medicaidClaimsAgg.count({ where }),
  ])

  return NextResponse.json({
    claims: claims.map(c => ({
      ...c,
      paidAmount: c.paidAmount ? Number(c.paidAmount) : null,
    })),
    total,
    limit,
    offset,
  })
}
