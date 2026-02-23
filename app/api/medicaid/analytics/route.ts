import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/medicaid/analytics?type=provider-summary&npi=...
//                            ?type=proc-code-summary&code=...
//                            ?type=anomalies&npi=...
//                            ?type=dashboard&time_range=last_30_days|last_90_days|ytd|all
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type') ?? 'dashboard'

  // ── Provider Summary ──────────────────────────────────────────────────────
  if (type === 'provider-summary') {
    const npi = searchParams.get('npi')
    if (!npi) return NextResponse.json({ error: 'npi required' }, { status: 400 })

    const [provider, agg, topCodes, monthly, patientCount] = await Promise.all([
      prisma.medicaidProvider.findUnique({ where: { npi } }),

      prisma.medicaidClaimsAgg.aggregate({
        where: { billingNpi: npi },
        _sum:   { numClaims: true, numBeneficiaries: true, paidAmount: true },
        _count: true,
      }),

      prisma.medicaidClaimsAgg.groupBy({
        by: ['procCode'],
        where: { billingNpi: npi },
        _sum: { numClaims: true, paidAmount: true },
        orderBy: { _sum: { numClaims: 'desc' } },
        take: 10,
      }),

      prisma.medicaidClaimsAgg.groupBy({
        by: ['yearMonth'],
        where: { billingNpi: npi },
        _sum: { numClaims: true, paidAmount: true },
        orderBy: { yearMonth: 'asc' },
      }),

      prisma.medicaidPatient.count({ where: { primaryProviderNpi: npi } }),
    ])

    if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 })

    // Enrich top codes with descriptions
    const codes = topCodes.map(c => c.procCode)
    const hcpcs = await prisma.hcpcsCode.findMany({ where: { code: { in: codes } } })
    const hcpcsMap = new Map(hcpcs.map(h => [h.code, h]))

    return NextResponse.json({
      provider,
      summary: {
        totalClaims:        agg._sum.numClaims ?? 0,
        totalBeneficiaries: agg._sum.numBeneficiaries ?? 0,
        totalPaid:          Number(agg._sum.paidAmount ?? 0),
        avgPaidPerClaim:    agg._sum.numClaims
          ? Number(agg._sum.paidAmount ?? 0) / agg._sum.numClaims
          : 0,
        activePatients: patientCount,
      },
      topProcedures: topCodes.map(c => ({
        procCode:    c.procCode,
        description: hcpcsMap.get(c.procCode)?.description ?? null,
        numClaims:   c._sum.numClaims ?? 0,
        totalPaid:   Number(c._sum.paidAmount ?? 0),
      })),
      monthlyTrend: monthly.map(m => ({
        yearMonth: m.yearMonth,
        numClaims: m._sum.numClaims ?? 0,
        totalPaid: Number(m._sum.paidAmount ?? 0),
      })),
    })
  }

  // ── Proc Code Summary ─────────────────────────────────────────────────────
  if (type === 'proc-code-summary') {
    const code = searchParams.get('code')
    if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

    const [hcpcs, agg, topProviders] = await Promise.all([
      prisma.hcpcsCode.findUnique({ where: { code } }),

      prisma.medicaidClaimsAgg.aggregate({
        where: { procCode: code },
        _sum:   { numClaims: true, paidAmount: true },
        _count: true,
      }),

      prisma.medicaidClaimsAgg.groupBy({
        by: ['billingNpi'],
        where: { procCode: code },
        _sum: { numClaims: true, paidAmount: true },
        orderBy: { _sum: { numClaims: 'desc' } },
        take: 10,
      }),
    ])

    const providerNpis = topProviders.map(p => p.billingNpi)
    const providers = await prisma.medicaidProvider.findMany({
      where: { npi: { in: providerNpis } },
      select: { npi: true, orgName: true, firstName: true, lastName: true, city: true, state: true },
    })
    const providerMap = new Map(providers.map(p => [p.npi, p]))

    return NextResponse.json({
      code,
      description: hcpcs?.description ?? null,
      category:    hcpcs?.category ?? null,
      avgCostTx:   hcpcs?.avgCostTx ? Number(hcpcs.avgCostTx) : null,
      summary: {
        totalClaims: agg._sum.numClaims ?? 0,
        totalPaid:   Number(agg._sum.paidAmount ?? 0),
      },
      topProviders: topProviders.map(p => ({
        npi:       p.billingNpi,
        provider:  providerMap.get(p.billingNpi),
        numClaims: p._sum.numClaims ?? 0,
        totalPaid: Number(p._sum.paidAmount ?? 0),
      })),
    })
  }

  // ── Anomaly Detection ─────────────────────────────────────────────────────
  if (type === 'anomalies') {
    const npi = searchParams.get('npi')
    if (!npi) return NextResponse.json({ error: 'npi required' }, { status: 400 })

    // Per-code averages across all Texas providers
    const providerCodeStats = await prisma.medicaidClaimsAgg.groupBy({
      by: ['procCode'],
      where: { billingNpi: npi },
      _sum: { numClaims: true, paidAmount: true },
    })

    const codes = providerCodeStats.map(s => s.procCode)
    const txAverages = await prisma.medicaidClaimsAgg.groupBy({
      by: ['procCode'],
      where: { procCode: { in: codes } },
      _avg: { paidAmount: true },
      _sum: { numClaims: true },
    })
    const txMap = new Map(txAverages.map(t => [t.procCode, t]))

    // Monthly volume for spike detection
    const monthly = await prisma.medicaidClaimsAgg.groupBy({
      by: ['yearMonth'],
      where: { billingNpi: npi },
      _sum: { numClaims: true },
      orderBy: { yearMonth: 'asc' },
    })

    const anomalies: Array<{
      type: string
      procCode?: string
      detail: string
      severity: 'low' | 'medium' | 'high'
    }> = []

    // Flag codes where provider's avg paid is >50% above TX average
    for (const stat of providerCodeStats) {
      const txAvg = Number(txMap.get(stat.procCode)?._avg.paidAmount ?? 0)
      const providerAvg = stat._sum.numClaims && stat._sum.paidAmount
        ? Number(stat._sum.paidAmount) / stat._sum.numClaims
        : 0
      if (txAvg > 0 && providerAvg > txAvg * 1.5) {
        anomalies.push({
          type: 'cost_outlier',
          procCode: stat.procCode,
          detail: `Avg paid $${providerAvg.toFixed(2)} vs TX avg $${txAvg.toFixed(2)} (+${((providerAvg / txAvg - 1) * 100).toFixed(0)}%)`,
          severity: providerAvg > txAvg * 2 ? 'high' : 'medium',
        })
      }
    }

    // Flag monthly volume spikes (>3x the provider's own average)
    if (monthly.length > 3) {
      const volumes = monthly.map(m => m._sum.numClaims ?? 0)
      const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length
      for (const m of monthly) {
        const vol = m._sum.numClaims ?? 0
        if (vol > avgVol * 3) {
          anomalies.push({
            type: 'volume_spike',
            detail: `${m.yearMonth}: ${vol.toLocaleString()} claims (${(vol / avgVol).toFixed(1)}x monthly avg of ${avgVol.toFixed(0)})`,
            severity: vol > avgVol * 5 ? 'high' : 'medium',
          })
        }
      }
    }

    return NextResponse.json({
      npi,
      anomalyCount: anomalies.length,
      anomalies: anomalies.sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0)),
    })
  }

  // ── Dashboard Stats ───────────────────────────────────────────────────────
  const timeRange = searchParams.get('time_range') ?? 'all'
  let fromYM: string | undefined
  const now = new Date()
  if (timeRange === 'last_30_days') {
    fromYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  } else if (timeRange === 'last_90_days') {
    const d = new Date(now); d.setMonth(d.getMonth() - 3)
    fromYM = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  } else if (timeRange === 'ytd') {
    fromYM = `${now.getFullYear()}-01`
  }

  const claimWhere = fromYM ? { yearMonth: { gte: fromYM } } : {}

  const [claimAgg, providerCount, patientCount, encounterAgg, deniedCount, flaggedCount] =
    await Promise.all([
      prisma.medicaidClaimsAgg.aggregate({
        where: claimWhere,
        _sum: { numClaims: true, paidAmount: true, numBeneficiaries: true },
      }),
      prisma.medicaidProvider.count(),
      prisma.medicaidPatient.count(),
      prisma.medicaidEncounter.aggregate({ _count: true }),
      prisma.medicaidEncounter.count({ where: { claimStatus: 'denied' } }),
      prisma.medicaidEncounter.count({ where: { claimStatus: 'flagged' } }),
    ])

  const totalEncounters = encounterAgg._count
  const denialRate = totalEncounters > 0
    ? ((deniedCount / totalEncounters) * 100).toFixed(1)
    : '0.0'

  return NextResponse.json({
    timeRange,
    totalClaims:       claimAgg._sum.numClaims ?? 0,
    totalPaid:         Number(claimAgg._sum.paidAmount ?? 0),
    totalBeneficiaries: claimAgg._sum.numBeneficiaries ?? 0,
    totalProviders:    providerCount,
    totalPatients:     patientCount,
    totalEncounters,
    deniedEncounters:  deniedCount,
    flaggedEncounters: flaggedCount,
    denialRate:        `${denialRate}%`,
  })
}
