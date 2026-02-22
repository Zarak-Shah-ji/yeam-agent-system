'use client'

import { useRouter } from 'next/navigation'
import { differenceInYears, format } from 'date-fns'
import { ArrowLeft, Phone, Mail, MapPin, Calendar, FileText, CreditCard } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'

const CLAIM_STATUS_VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'info' | 'destructive' | 'secondary' | 'outline'> = {
  PAID: 'success', DENIED: 'destructive', PENDING: 'warning', SCRUBBING: 'warning',
  SUBMITTED: 'info', ACCEPTED: 'info', APPEALED: 'outline', VOIDED: 'secondary',
}

const APPT_STATUS_VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'info' | 'destructive' | 'secondary' | 'outline'> = {
  SCHEDULED: 'secondary', CHECKED_IN: 'info', IN_PROGRESS: 'warning',
  COMPLETED: 'success', CANCELLED: 'destructive', NO_SHOW: 'outline',
}

export function PatientDetail({ id }: { id: string }) {
  const router = useRouter()
  const { data: patient, isLoading } = trpc.patients.get.useQuery({ id })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!patient) {
    return <div className="text-gray-500 p-8 text-center">Patient not found.</div>
  }

  const age = differenceInYears(new Date(), new Date(patient.dateOfBirth))
  const primaryCoverage = patient.coverages.find(c => c.isPrimary && c.active) ?? patient.coverages[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {patient.firstName} {patient.lastName}
          </h1>
          <p className="text-sm text-gray-500">{patient.mrn} · {age}y · {patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : patient.gender}</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Phone className="h-4 w-4 text-gray-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Phone</p>
              <p className="text-sm font-medium">{patient.phone ?? '—'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Mail className="h-4 w-4 text-gray-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Email</p>
              <p className="text-sm font-medium truncate max-w-[120px]">{patient.email ?? '—'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Location</p>
              <p className="text-sm font-medium">{patient.city ?? '—'}{patient.state ? `, ${patient.state}` : ''}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CreditCard className="h-4 w-4 text-gray-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-500">Insurance</p>
              <p className="text-sm font-medium truncate max-w-[120px]">{primaryCoverage?.payer.name ?? 'Self-pay'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="appointments">Appointments ({patient.appointments.length})</TabsTrigger>
          <TabsTrigger value="encounters">Encounters ({patient.encounters.length})</TabsTrigger>
          <TabsTrigger value="claims">Claims ({patient.claims.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 mt-2 lg:grid-cols-2">
            {/* Demographics */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Demographics</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-gray-500">Date of Birth</dt>
                  <dd>{format(new Date(patient.dateOfBirth), 'MMMM d, yyyy')}</dd>
                  <dt className="text-gray-500">Age</dt>
                  <dd>{age} years</dd>
                  <dt className="text-gray-500">Gender</dt>
                  <dd>{patient.gender === 'M' ? 'Male' : patient.gender === 'F' ? 'Female' : patient.gender}</dd>
                  <dt className="text-gray-500">SSN (last 4)</dt>
                  <dd>{patient.ssnLast4 ? `***-**-${patient.ssnLast4}` : '—'}</dd>
                  <dt className="text-gray-500">Language</dt>
                  <dd className="capitalize">{patient.preferredLanguage ?? 'English'}</dd>
                  <dt className="text-gray-500">Address</dt>
                  <dd className="col-span-1">{patient.address ? `${patient.address}, ${patient.city}, ${patient.state} ${patient.zip}` : '—'}</dd>
                </dl>
              </CardContent>
            </Card>

            {/* Insurance */}
            {primaryCoverage && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm">Primary Insurance</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <dl className="grid grid-cols-2 gap-y-2 text-sm">
                    <dt className="text-gray-500">Payer</dt>
                    <dd className="font-medium">{primaryCoverage.payer.name}</dd>
                    <dt className="text-gray-500">Plan Type</dt>
                    <dd><Badge variant="secondary">{primaryCoverage.payer.planType}</Badge></dd>
                    <dt className="text-gray-500">Member ID</dt>
                    <dd>{primaryCoverage.memberId}</dd>
                    <dt className="text-gray-500">Group #</dt>
                    <dd>{primaryCoverage.groupNumber ?? '—'}</dd>
                    <dt className="text-gray-500">Copay</dt>
                    <dd>${primaryCoverage.copay?.toString() ?? '0'}</dd>
                    <dt className="text-gray-500">Deductible</dt>
                    <dd>
                      ${primaryCoverage.deductibleMet?.toString() ?? '0'} / ${primaryCoverage.deductible?.toString() ?? '0'}
                    </dd>
                  </dl>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="appointments">
          <Card className="mt-2">
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {patient.appointments.length === 0 ? (
                  <p className="text-center py-8 text-sm text-gray-400">No appointments on record</p>
                ) : patient.appointments.map(a => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-gray-400 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{format(new Date(a.scheduledAt), 'MMM d, yyyy h:mm a')}</p>
                        <p className="text-xs text-gray-500">{a.provider.firstName} {a.provider.lastName}, {a.provider.credential} · {a.chiefComplaint}</p>
                      </div>
                    </div>
                    <Badge variant={APPT_STATUS_VARIANTS[a.status] ?? 'secondary'} className="text-xs">
                      {a.status.replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="encounters">
          <Card className="mt-2">
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {patient.encounters.length === 0 ? (
                  <p className="text-center py-8 text-sm text-gray-400">No encounters on record</p>
                ) : patient.encounters.map(e => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/encounters/${e.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{format(new Date(e.encounterDate), 'MMM d, yyyy')}</p>
                        <p className="text-xs text-gray-500">{e.provider.firstName} {e.provider.lastName}, {e.provider.credential}</p>
                      </div>
                    </div>
                    <Badge variant={e.status === 'SIGNED' ? 'success' : 'secondary'} className="text-xs">
                      {e.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="claims">
          <Card className="mt-2">
            <CardContent className="p-0">
              <div className="divide-y divide-gray-100">
                {patient.claims.length === 0 ? (
                  <p className="text-center py-8 text-sm text-gray-400">No claims on record</p>
                ) : patient.claims.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{c.claimNumber}</p>
                      <p className="text-xs text-gray-500">{c.payer.name} · {format(new Date(c.serviceDate), 'MMM d, yyyy')}</p>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <div>
                        <p className="text-sm font-medium">${Number(c.totalCharge).toFixed(2)}</p>
                        {c.paidAmount && <p className="text-xs text-green-600">Paid: ${Number(c.paidAmount).toFixed(2)}</p>}
                      </div>
                      <Badge variant={CLAIM_STATUS_VARIANTS[c.status] ?? 'secondary'} className="text-xs">
                        {c.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
