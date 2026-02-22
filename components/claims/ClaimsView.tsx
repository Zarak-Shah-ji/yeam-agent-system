'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { FileText, RefreshCw } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const STATUS_VARIANTS: Record<string, 'default' | 'success' | 'warning' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'secondary',
  SCRUBBING: 'warning',
  SUBMITTED: 'default',
  PAID: 'success',
  DENIED: 'destructive',
  APPEALED: 'outline',
  VOIDED: 'secondary',
}

export function ClaimsView() {
  const [statusFilter, setStatusFilter] = useState('ALL')

  const { data, isLoading, refetch } = trpc.claims.list.useQuery({
    status: statusFilter !== 'ALL' ? statusFilter : undefined,
    limit: 50,
  })

  const claims = data?.claims ?? []

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="w-48">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="SCRUBBING">Scrubbing</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="DENIED">Denied</SelectItem>
                <SelectItem value="APPEALED">Appealed</SelectItem>
                <SelectItem value="VOIDED">Voided</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-gray-500 ml-auto">
            {claims.length} claim{claims.length !== 1 ? 's' : ''}
          </span>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Claim #</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Service Date</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Denial Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : claims.map(claim => (
                    <TableRow key={claim.id}>
                      <TableCell className="font-mono text-xs">{claim.claimNumber}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">
                          {claim.patient.firstName} {claim.patient.lastName}
                        </div>
                        <div className="text-xs text-gray-400">{claim.patient.mrn}</div>
                      </TableCell>
                      <TableCell className="text-sm">{claim.payer.name}</TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(claim.serviceDate), 'MM/dd/yyyy')}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        ${Number(claim.totalCharge).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {claim.paidAmount != null ? `$${Number(claim.paidAmount).toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[claim.status] ?? 'secondary'}>
                          {claim.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-500 max-w-[160px] truncate">
                        {claim.denialReason ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))
              }
            </TableBody>
          </Table>

          {!isLoading && claims.length === 0 && (
            <div className="py-12 text-center">
              <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No claims found</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
