'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { FileText } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'

const STATUS_VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'warning', SIGNED: 'success', AMENDED: 'info' as 'default', VOIDED: 'destructive',
}

export function EncounterList() {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState('ALL')

  const { data, isLoading } = trpc.encounters.list.useQuery({
    status: statusFilter !== 'ALL' ? statusFilter : undefined,
    limit: 30,
  })

  const encounters = data?.encounters ?? []

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-44">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="SIGNED">Signed</SelectItem>
                <SelectItem value="AMENDED">Amended</SelectItem>
                <SelectItem value="VOIDED">Voided</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-gray-500 ml-auto">{encounters.length} encounter{encounters.length !== 1 ? 's' : ''}</span>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Primary Diagnosis</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : encounters.map(enc => {
                    const primaryDx = enc.diagnoses[0]
                    return (
                      <TableRow key={enc.id}>
                        <TableCell className="font-medium">
                          {format(new Date(enc.encounterDate), 'MM/dd/yyyy')}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{enc.patient.firstName} {enc.patient.lastName}</div>
                          <div className="text-xs text-gray-400">{enc.patient.mrn}</div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {enc.provider.firstName} {enc.provider.lastName}
                          {enc.provider.credential && <span className="text-gray-400">, {enc.provider.credential}</span>}
                        </TableCell>
                        <TableCell>
                          {primaryDx ? (
                            <div>
                              <span className="text-xs font-mono bg-gray-100 px-1 py-0.5 rounded">{primaryDx.icdCode}</span>
                              <span className="text-xs text-gray-500 ml-1 truncate max-w-[160px] inline-block align-middle">{primaryDx.description}</span>
                            </div>
                          ) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANTS[enc.status] ?? 'secondary'}>{enc.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => router.push(`/encounters/${enc.id}`)}>
                            <FileText className="h-3 w-3 mr-1" />View
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })
              }
            </TableBody>
          </Table>

          {!isLoading && encounters.length === 0 && (
            <div className="py-12 text-center">
              <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No encounters found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
