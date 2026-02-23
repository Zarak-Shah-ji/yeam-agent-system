import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

type MaybeMedicaid = Record<string, unknown> | null

/**
 * Execute a Medicaid-related Gemini function call.
 * Returns null if `name` is not a recognised Medicaid tool (so the caller
 * can fall through to the EHR tool handler).
 */
export async function executeMedicaidFunction(
  name: string,
  args: Record<string, unknown>,
): Promise<MaybeMedicaid> {
  switch (name) {
    // ── 1. search_providers ───────────────────────────────────────────────────
    case 'search_providers': {
      const query  = args.query   ? String(args.query).trim()   : undefined
      const city   = args.city    ? String(args.city).trim()    : undefined
      const zip    = args.zip     ? String(args.zip).trim()     : undefined
      const sortBy = args.sort_by ? String(args.sort_by).trim() : 'total_claims'
      const limit  = Math.min(Number(args.limit ?? 10), 50)

      // Build provider-side filters
      const providerWhere: Prisma.MedicaidProviderWhereInput = {}
      if (query) {
        providerWhere.OR = [
          { orgName:   { contains: query, mode: 'insensitive' } },
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName:  { contains: query, mode: 'insensitive' } },
          { npi:       { equals: query } },
        ]
      }
      if (city) providerWhere.city = { contains: city, mode: 'insensitive' }
      if (zip)  providerWhere.zip  = { startsWith: zip }

      // When a city/zip filter is present, sort by claim volume on the DB side
      // so "top billers in Houston" returns the highest-volume providers first.
      if (city || zip) {
        // Step 1: get all NPIs matching the geographic filter
        const matchingProviders = await prisma.medicaidProvider.findMany({
          where: providerWhere,
          select: { npi: true },
        })
        const npis = matchingProviders.map(p => p.npi)

        // Step 2: aggregate + sort by the requested metric
        const stats = await prisma.medicaidClaimsAgg.groupBy({
          by: ['billingNpi'],
          where: { billingNpi: { in: npis } },
          _sum: { numClaims: true, paidAmount: true },
          orderBy: sortBy === 'total_paid'
            ? { _sum: { paidAmount: 'desc' } }
            : { _sum: { numClaims: 'desc' } },
          take: limit,
        })

        // Step 3: fetch full provider details for the top NPIs
        const topNpis     = stats.map(s => s.billingNpi)
        const providers   = await prisma.medicaidProvider.findMany({
          where: { npi: { in: topNpis } },
        })
        const providerMap = new Map(providers.map(p => [p.npi, p]))
        const statsMap    = new Map(stats.map(s => [s.billingNpi, s]))

        // Preserve the claim-sorted order
        const ordered = topNpis
          .map(npi => providerMap.get(npi))
          .filter(Boolean) as typeof providers

        return {
          providers: ordered.map(p => ({
            npi:         p.npi,
            name:        p.orgName ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
            credentials: p.credentials,
            city:        p.city,
            state:       p.state,
            zip:         p.zip,
            totalClaims: statsMap.get(p.npi)?._sum.numClaims ?? 0,
            totalPaid:   Number(statsMap.get(p.npi)?._sum.paidAmount ?? 0),
          })),
          total: ordered.length,
          sortedBy: sortBy,
        }
      }

      // No city/zip — standard text search sorted alphabetically
      const providers = await prisma.medicaidProvider.findMany({
        where: providerWhere, take: limit, orderBy: { orgName: 'asc' },
      })
      const npis  = providers.map(p => p.npi)
      const stats = await prisma.medicaidClaimsAgg.groupBy({
        by: ['billingNpi'],
        where: { billingNpi: { in: npis } },
        _sum: { numClaims: true, paidAmount: true },
      })
      const statsMap = new Map(stats.map(s => [s.billingNpi, s]))

      return {
        providers: providers.map(p => ({
          npi:         p.npi,
          name:        p.orgName ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
          credentials: p.credentials,
          city:        p.city,
          state:       p.state,
          zip:         p.zip,
          totalClaims: statsMap.get(p.npi)?._sum.numClaims ?? 0,
          totalPaid:   Number(statsMap.get(p.npi)?._sum.paidAmount ?? 0),
        })),
        total: providers.length,
      }
    }

    // ── 2. get_provider_analytics ─────────────────────────────────────────────
    case 'get_provider_analytics': {
      const npi = String(args.npi ?? '').trim()
      if (!npi) return { error: 'npi is required' }

      const [provider, agg, topCodes, monthly, patientCount] = await Promise.all([
        prisma.medicaidProvider.findUnique({ where: { npi } }),

        prisma.medicaidClaimsAgg.aggregate({
          where: { billingNpi: npi },
          _sum: { numClaims: true, numBeneficiaries: true, paidAmount: true },
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

      if (!provider) return { error: `Provider NPI ${npi} not found` }

      const codes   = topCodes.map(c => c.procCode)
      const hcpcs   = await prisma.hcpcsCode.findMany({ where: { code: { in: codes } } })
      const hcpcsMap = new Map(hcpcs.map(h => [h.code, h.description]))

      const totalClaims = agg._sum.numClaims ?? 0
      const totalPaid   = Number(agg._sum.paidAmount ?? 0)

      return {
        provider: {
          npi:         provider.npi,
          name:        provider.orgName ?? `${provider.firstName ?? ''} ${provider.lastName ?? ''}`.trim(),
          city:        provider.city,
          state:       provider.state,
          credentials: provider.credentials,
        },
        summary: {
          totalClaims,
          totalBeneficiaries: agg._sum.numBeneficiaries ?? 0,
          totalPaid,
          avgPaidPerClaim: totalClaims ? totalPaid / totalClaims : 0,
          activePatients: patientCount,
        },
        topProcedures: topCodes.map(c => ({
          procCode:    c.procCode,
          description: hcpcsMap.get(c.procCode) ?? null,
          numClaims:   c._sum.numClaims ?? 0,
          totalPaid:   Number(c._sum.paidAmount ?? 0),
        })),
        // Return last 12 months of trend data to keep the payload manageable
        monthlyTrend: monthly.slice(-12).map(m => ({
          yearMonth: m.yearMonth,
          numClaims: m._sum.numClaims ?? 0,
          totalPaid: Number(m._sum.paidAmount ?? 0),
        })),
      }
    }

    // ── 3. search_medicaid_claims ─────────────────────────────────────────────
    case 'search_medicaid_claims': {
      const npi      = args.npi       ? String(args.npi).trim()       : undefined
      const procCode = args.proc_code ? String(args.proc_code).trim() : undefined
      const fromDate = args.from_date ? String(args.from_date).trim() : undefined
      const toDate   = args.to_date   ? String(args.to_date).trim()   : undefined
      const limit    = Math.min(Number(args.limit ?? 20), 100)

      const where: Prisma.MedicaidClaimsAggWhereInput = {}
      if (npi)      where.billingNpi = npi
      if (procCode) where.procCode   = procCode
      if (fromDate || toDate) {
        where.yearMonth = {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toDate   ? { lte: toDate   } : {}),
        }
      }

      const claims = await prisma.medicaidClaimsAgg.findMany({
        where,
        include: {
          billingProvider: { select: { orgName: true, firstName: true, lastName: true, city: true } },
        },
        orderBy: { yearMonth: 'desc' },
        take: limit,
      })

      return {
        claims: claims.map(c => ({
          billingNpi:       c.billingNpi,
          provider:         c.billingProvider?.orgName ??
            `${c.billingProvider?.firstName ?? ''} ${c.billingProvider?.lastName ?? ''}`.trim(),
          city:             c.billingProvider?.city ?? null,
          procCode:         c.procCode,
          yearMonth:        c.yearMonth,
          numClaims:        c.numClaims,
          numBeneficiaries: c.numBeneficiaries,
          paidAmount:       Number(c.paidAmount ?? 0),
        })),
        total: claims.length,
      }
    }

    // ── 4. get_procedure_info ─────────────────────────────────────────────────
    case 'get_procedure_info': {
      const code = String(args.code ?? '').trim().toUpperCase()
      if (!code) return { error: 'code is required' }

      const [hcpcs, agg, topProviders] = await Promise.all([
        prisma.hcpcsCode.findUnique({ where: { code } }),

        prisma.medicaidClaimsAgg.aggregate({
          where: { procCode: code },
          _sum:  { numClaims: true, paidAmount: true },
        }),

        prisma.medicaidClaimsAgg.groupBy({
          by: ['billingNpi'],
          where: { procCode: code },
          _sum:  { numClaims: true, paidAmount: true },
          orderBy: { _sum: { numClaims: 'desc' } },
          take: 5,
        }),
      ])

      const providerNpis = topProviders.map(p => p.billingNpi)
      const providers    = await prisma.medicaidProvider.findMany({
        where:  { npi: { in: providerNpis } },
        select: { npi: true, orgName: true, firstName: true, lastName: true, city: true },
      })
      const providerMap = new Map(providers.map(p => [p.npi, p]))

      const totalClaims = agg._sum.numClaims ?? 0
      const totalPaid   = Number(agg._sum.paidAmount ?? 0)

      return {
        code,
        description: hcpcs?.description ?? 'No description available',
        category:    hcpcs?.category ?? null,
        avgCostTx:   hcpcs?.avgCostTx
          ? Number(hcpcs.avgCostTx)
          : totalClaims ? totalPaid / totalClaims : null,
        summary: { totalClaims, totalPaid },
        topProviders: topProviders.map(p => {
          const prov = providerMap.get(p.billingNpi)
          return {
            npi:       p.billingNpi,
            name:      prov?.orgName ?? `${prov?.firstName ?? ''} ${prov?.lastName ?? ''}`.trim(),
            city:      prov?.city ?? null,
            numClaims: p._sum.numClaims ?? 0,
            totalPaid: Number(p._sum.paidAmount ?? 0),
          }
        }),
      }
    }

    // ── 5. detect_anomalies ───────────────────────────────────────────────────
    case 'detect_anomalies': {
      const npi = String(args.npi ?? '').trim()
      if (!npi) return { error: 'npi is required' }

      const providerCodeStats = await prisma.medicaidClaimsAgg.groupBy({
        by: ['procCode'],
        where: { billingNpi: npi },
        _sum: { numClaims: true, paidAmount: true },
      })

      const codes      = providerCodeStats.map(s => s.procCode)
      const txAverages = await prisma.medicaidClaimsAgg.groupBy({
        by: ['procCode'],
        where: { procCode: { in: codes } },
        _avg: { paidAmount: true },
        _sum: { numClaims: true },
      })
      const txMap = new Map(txAverages.map(t => [t.procCode, t]))

      const monthly = await prisma.medicaidClaimsAgg.groupBy({
        by: ['yearMonth'],
        where: { billingNpi: npi },
        _sum: { numClaims: true },
        orderBy: { yearMonth: 'asc' },
      })

      type Anomaly = { type: string; procCode?: string; detail: string; severity: 'low' | 'medium' | 'high' }
      const anomalies: Anomaly[] = []

      for (const stat of providerCodeStats) {
        const txAvg      = Number(txMap.get(stat.procCode)?._avg.paidAmount ?? 0)
        const provAvg    = stat._sum.numClaims && stat._sum.paidAmount
          ? Number(stat._sum.paidAmount) / stat._sum.numClaims
          : 0
        if (txAvg > 0 && provAvg > txAvg * 1.5) {
          anomalies.push({
            type:     'cost_outlier',
            procCode: stat.procCode,
            detail:   `Avg paid $${provAvg.toFixed(2)} vs TX avg $${txAvg.toFixed(2)} (+${((provAvg / txAvg - 1) * 100).toFixed(0)}%)`,
            severity: provAvg > txAvg * 2 ? 'high' : 'medium',
          })
        }
      }

      if (monthly.length > 3) {
        const volumes = monthly.map(m => m._sum.numClaims ?? 0)
        const avgVol  = volumes.reduce((a, b) => a + b, 0) / volumes.length
        for (const m of monthly) {
          const vol = m._sum.numClaims ?? 0
          if (vol > avgVol * 3) {
            anomalies.push({
              type:     'volume_spike',
              detail:   `${m.yearMonth}: ${vol.toLocaleString()} claims (${(vol / avgVol).toFixed(1)}x avg of ${avgVol.toFixed(0)})`,
              severity: vol > avgVol * 5 ? 'high' : 'medium',
            })
          }
        }
      }

      const highCount   = anomalies.filter(a => a.severity === 'high').length
      const mediumCount = anomalies.filter(a => a.severity === 'medium').length

      return {
        npi,
        anomalyCount: anomalies.length,
        anomalies: anomalies.sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0)),
        summary: anomalies.length === 0
          ? 'No significant billing anomalies detected.'
          : `${highCount} high-severity and ${mediumCount} medium-severity anomalies found.`,
      }
    }

    // ── 6. search_medicaid_patients ───────────────────────────────────────────
    case 'search_medicaid_patients': {
      const query       = args.query        ? String(args.query).trim()        : undefined
      const providerNpi = args.provider_npi ? String(args.provider_npi).trim() : undefined
      const limit       = Math.min(Number(args.limit ?? 10), 50)

      const where: Prisma.MedicaidPatientWhereInput = {}
      if (query) {
        where.OR = [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName:  { contains: query, mode: 'insensitive' } },
          { mrn:       { contains: query, mode: 'insensitive' } },
        ]
      }
      if (providerNpi) where.primaryProviderNpi = providerNpi

      const patients = await prisma.medicaidPatient.findMany({
        where,
        include: {
          primaryProvider: {
            select: { npi: true, orgName: true, firstName: true, lastName: true, city: true },
          },
        },
        take: limit,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      })

      return {
        patients: patients.map(p => ({
          id:              p.id,
          mrn:             p.mrn,
          name:            `${p.firstName} ${p.lastName}`,
          dateOfBirth:     p.dateOfBirth.toISOString().split('T')[0],
          gender:          p.gender,
          city:            p.city,
          insuranceStatus: p.insuranceStatus,
          primaryProvider: p.primaryProvider
            ? (p.primaryProvider.orgName ??
               `${p.primaryProvider.firstName ?? ''} ${p.primaryProvider.lastName ?? ''}`.trim())
            : null,
        })),
        total: patients.length,
      }
    }

    // ── 7. get_patient_encounters ─────────────────────────────────────────────
    case 'get_patient_encounters': {
      const patientId   = String(args.patient_id ?? '').trim()
      const status      = args.status       ? String(args.status).trim()       : undefined
      const claimStatus = args.claim_status ? String(args.claim_status).trim() : undefined
      const limit       = Math.min(Number(args.limit ?? 20), 100)

      if (!patientId) return { error: 'patient_id is required' }

      const where: Prisma.MedicaidEncounterWhereInput = { patientId }
      if (status)      where.status      = status
      if (claimStatus) where.claimStatus = claimStatus

      const [patient, encounters] = await Promise.all([
        prisma.medicaidPatient.findUnique({
          where: { id: patientId },
          select: { mrn: true, firstName: true, lastName: true },
        }),
        prisma.medicaidEncounter.findMany({
          where,
          include: {
            provider: { select: { npi: true, orgName: true, firstName: true, lastName: true } },
          },
          orderBy: { encounterDate: 'desc' },
          take: limit,
        }),
      ])

      if (!patient) return { error: `Patient ${patientId} not found` }

      return {
        patient:    { mrn: patient.mrn, name: `${patient.firstName} ${patient.lastName}` },
        encounters: encounters.map(e => ({
          id:             e.id,
          encounterDate:  e.encounterDate.toISOString().split('T')[0],
          provider:       e.provider?.orgName ??
            `${e.provider?.firstName ?? ''} ${e.provider?.lastName ?? ''}`.trim(),
          procCode:       e.procCode,
          diagnosisCodes: e.diagnosisCodes,
          status:         e.status,
          claimStatus:    e.claimStatus,
          paidAmount:     e.paidAmount ? Number(e.paidAmount) : null,
        })),
        total: encounters.length,
      }
    }

    // ── 8. get_medicaid_dashboard ─────────────────────────────────────────────
    case 'get_medicaid_dashboard': {
      const timeRange = args.time_range ? String(args.time_range).trim() : 'all'
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

      const claimWhere: Prisma.MedicaidClaimsAggWhereInput = fromYM ? { yearMonth: { gte: fromYM } } : {}

      const [claimAgg, providerCount, patientCount, encounterAgg, deniedCount, flaggedCount] =
        await Promise.all([
          prisma.medicaidClaimsAgg.aggregate({
            where: claimWhere,
            _sum:  { numClaims: true, paidAmount: true, numBeneficiaries: true },
          }),
          prisma.medicaidProvider.count(),
          prisma.medicaidPatient.count(),
          prisma.medicaidEncounter.aggregate({ _count: true }),
          prisma.medicaidEncounter.count({ where: { claimStatus: 'denied' } }),
          prisma.medicaidEncounter.count({ where: { claimStatus: 'flagged' } }),
        ])

      const totalEncounters = encounterAgg._count
      const denialRate = totalEncounters > 0
        ? `${((deniedCount / totalEncounters) * 100).toFixed(1)}%`
        : '0.0%'

      return {
        timeRange,
        totalClaims:        claimAgg._sum.numClaims ?? 0,
        totalPaid:          Number(claimAgg._sum.paidAmount ?? 0),
        totalBeneficiaries: claimAgg._sum.numBeneficiaries ?? 0,
        totalProviders:     providerCount,
        totalPatients:      patientCount,
        totalEncounters,
        deniedEncounters:   deniedCount,
        flaggedEncounters:  flaggedCount,
        denialRate,
      }
    }

    default:
      return null
  }
}
