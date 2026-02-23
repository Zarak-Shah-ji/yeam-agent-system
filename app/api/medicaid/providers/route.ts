import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/medicaid/providers?q=smith&city=houston&zip=77001&limit=20&offset=0
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const q       = searchParams.get('q')?.trim()
  const city    = searchParams.get('city')?.trim()
  const zip     = searchParams.get('zip')?.trim()
  const cred    = searchParams.get('credentials')?.trim()
  const limit   = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100)
  const offset  = parseInt(searchParams.get('offset') ?? '0')

  const where: Prisma.MedicaidProviderWhereInput = {}

  if (q) {
    where.OR = [
      { orgName:    { contains: q, mode: 'insensitive' } },
      { firstName:  { contains: q, mode: 'insensitive' } },
      { lastName:   { contains: q, mode: 'insensitive' } },
      { npi:        { equals: q } },
    ]
  }
  if (city) where.city = { contains: city, mode: 'insensitive' }
  if (zip)  where.zip  = { startsWith: zip }
  if (cred) where.credentials = { contains: cred, mode: 'insensitive' }

  const [providers, total] = await Promise.all([
    prisma.medicaidProvider.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { orgName: 'asc' },
    }),
    prisma.medicaidProvider.count({ where }),
  ])

  // Attach summary stats
  const npis = providers.map(p => p.npi)
  const stats = await prisma.medicaidClaimsAgg.groupBy({
    by: ['billingNpi'],
    where: { billingNpi: { in: npis } },
    _sum: { numClaims: true, paidAmount: true },
    _count: true,
  })
  const statsMap = new Map(stats.map(s => [s.billingNpi, s]))

  const patientCounts = await prisma.medicaidPatient.groupBy({
    by: ['primaryProviderNpi'],
    where: { primaryProviderNpi: { in: npis } },
    _count: true,
  })
  const patientMap = new Map(patientCounts.map(p => [p.primaryProviderNpi, p._count]))

  const enriched = providers.map(p => ({
    ...p,
    totalClaims:   statsMap.get(p.npi)?._sum.numClaims ?? 0,
    totalPaid:     statsMap.get(p.npi)?._sum.paidAmount ?? 0,
    activePatients: patientMap.get(p.npi) ?? 0,
  }))

  return NextResponse.json({ providers: enriched, total, limit, offset })
}
