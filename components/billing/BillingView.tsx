'use client'

import { trpc } from '@/lib/trpc/client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DeniedClaimCard } from './DeniedClaimCard'
import { format } from 'date-fns'

export function BillingView() {
  const { data: deniedData, isLoading: deniedLoading, refetch: refetchDenied } =
    trpc.claims.list.useQuery({ status: 'DENIED', limit: 50 })

  const { data: pendingData, isLoading: pendingLoading } =
    trpc.claims.list.useQuery({ status: 'SCRUBBING', limit: 50 })

  const deniedClaims = deniedData?.claims ?? []
  const pendingClaims = pendingData?.claims ?? []

  return (
    <Tabs defaultValue="denied">
      <TabsList>
        <TabsTrigger value="denied">
          Denied Claims
          {deniedClaims.length > 0 && (
            <Badge variant="destructive" className="ml-1.5 text-xs px-1.5 py-0">
              {deniedClaims.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="pending">
          Pending Submission
          {pendingClaims.length > 0 && (
            <Badge variant="warning" className="ml-1.5 text-xs px-1.5 py-0">
              {pendingClaims.length}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="denied" className="mt-4">
        {deniedLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
          </div>
        ) : deniedClaims.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-12">No denied claims — great work!</p>
        ) : (
          <div className="space-y-3">
            {deniedClaims.map(claim => (
              <DeniedClaimCard
                key={claim.id}
                claim={{
                  ...claim,
                  totalBilled: Number(claim.totalCharge),
                  serviceDate: claim.serviceDate,
                }}
                onStatusChange={() => refetchDenied()}
              />
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="pending" className="mt-4">
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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : pendingClaims.map(claim => (
                      <TableRow key={claim.id}>
                        <TableCell className="font-mono text-xs">{claim.claimNumber}</TableCell>
                        <TableCell className="text-sm">
                          {claim.patient.firstName} {claim.patient.lastName}
                        </TableCell>
                        <TableCell className="text-sm">{claim.payer.name}</TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(claim.serviceDate), 'MM/dd/yyyy')}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          ${Number(claim.totalCharge).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="warning">{claim.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                }
              </TableBody>
            </Table>
            {!pendingLoading && pendingClaims.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-8">No claims pending submission</p>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
