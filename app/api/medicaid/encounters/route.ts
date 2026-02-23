import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/medicaid/encounters?patient_id=...&provider_npi=...&status=...&claim_status=...&limit=20&offset=0
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const patientId   = searchParams.get('patient_id')?.trim()
  const providerNpi = searchParams.get('provider_npi')?.trim()
  const status      = searchParams.get('status')?.trim()
  const claimStatus = searchParams.get('claim_status')?.trim()
  const limit       = Math.min(parseInt(searchParams.get('limit') ?? '20'), 200)
  const offset      = parseInt(searchParams.get('offset') ?? '0')

  const where: Prisma.MedicaidEncounterWhereInput = {}
  if (patientId)   where.patientId   = patientId
  if (providerNpi) where.providerNpi = providerNpi
  if (status)      where.status      = status
  if (claimStatus) where.claimStatus = claimStatus

  const [encounters, total] = await Promise.all([
    prisma.medicaidEncounter.findMany({
      where,
      include: {
        patient:  { select: { mrn: true, firstName: true, lastName: true } },
        provider: { select: { npi: true, orgName: true, firstName: true, lastName: true } },
      },
      orderBy: { encounterDate: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.medicaidEncounter.count({ where }),
  ])

  return NextResponse.json({
    encounters: encounters.map(e => ({
      ...e,
      encounterDate: e.encounterDate.toISOString().split('T')[0],
      paidAmount: e.paidAmount ? Number(e.paidAmount) : null,
    })),
    total,
    limit,
    offset,
  })
}

// POST /api/medicaid/encounters
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { patientId, providerNpi, billingNpi, encounterDate, procCode, diagnosisCodes, notes } = body
  if (!patientId || !providerNpi || !encounterDate || !procCode) {
    return NextResponse.json({ error: 'patientId, providerNpi, encounterDate, procCode are required' }, { status: 400 })
  }

  const encounter = await prisma.medicaidEncounter.create({
    data: {
      patientId:      String(patientId),
      providerNpi:    String(providerNpi),
      billingNpi:     billingNpi ? String(billingNpi) : null,
      encounterDate:  new Date(String(encounterDate)),
      procCode:       String(procCode),
      diagnosisCodes: Array.isArray(diagnosisCodes) ? diagnosisCodes.map(String) : [],
      status:         'completed',
      claimStatus:    'clean',
      notes:          notes ? String(notes) : null,
    },
  })

  return NextResponse.json(encounter, { status: 201 })
}

// PATCH /api/medicaid/encounters/[id] — handled in [id]/route.ts, but we support bulk status update here
export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: string; status?: string; claimStatus?: string; notes?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updated = await prisma.medicaidEncounter.update({
    where: { id: body.id },
    data: {
      ...(body.status      ? { status:      body.status      } : {}),
      ...(body.claimStatus ? { claimStatus: body.claimStatus } : {}),
      ...(body.notes       ? { notes:       body.notes       } : {}),
    },
  })

  return NextResponse.json({
    ...updated,
    encounterDate: updated.encounterDate.toISOString().split('T')[0],
    paidAmount: updated.paidAmount ? Number(updated.paidAmount) : null,
  })
}
