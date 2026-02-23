import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/medicaid/patients?q=smith&provider_npi=...&limit=20&offset=0
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const q           = searchParams.get('q')?.trim()
  const providerNpi = searchParams.get('provider_npi')?.trim()
  const limit       = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100)
  const offset      = parseInt(searchParams.get('offset') ?? '0')

  const where: Prisma.MedicaidPatientWhereInput = {}
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName:  { contains: q, mode: 'insensitive' } },
      { mrn:       { contains: q, mode: 'insensitive' } },
    ]
  }
  if (providerNpi) where.primaryProviderNpi = providerNpi

  const [patients, total] = await Promise.all([
    prisma.medicaidPatient.findMany({
      where,
      include: { primaryProvider: { select: { npi: true, orgName: true, firstName: true, lastName: true, city: true } } },
      take: limit,
      skip: offset,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    prisma.medicaidPatient.count({ where }),
  ])

  return NextResponse.json({
    patients: patients.map(p => ({
      ...p,
      dateOfBirth: p.dateOfBirth.toISOString().split('T')[0],
    })),
    total,
    limit,
    offset,
  })
}

// POST /api/medicaid/patients — create a new patient
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { firstName, lastName, dateOfBirth, gender, phone, email, city, zip, primaryProviderNpi } = body

  if (!firstName || !lastName || !dateOfBirth) {
    return NextResponse.json({ error: 'firstName, lastName, dateOfBirth are required' }, { status: 400 })
  }

  // Generate MRN
  const count = await prisma.medicaidPatient.count()
  const mrn = `MRN-TX-${String(count + 1).padStart(6, '0')}`

  const patient = await prisma.medicaidPatient.create({
    data: {
      mrn,
      firstName: String(firstName),
      lastName:  String(lastName),
      dateOfBirth: new Date(String(dateOfBirth)),
      gender:    gender ? String(gender) : null,
      phone:     phone  ? String(phone)  : null,
      email:     email  ? String(email)  : null,
      city:      city   ? String(city)   : null,
      zip:       zip    ? String(zip)    : null,
      state: 'TX',
      insuranceType:   'Medicaid',
      insuranceStatus: 'active',
      primaryProviderNpi: primaryProviderNpi ? String(primaryProviderNpi) : null,
    },
  })

  return NextResponse.json(patient, { status: 201 })
}
