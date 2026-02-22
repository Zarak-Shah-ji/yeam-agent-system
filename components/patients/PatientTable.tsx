'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { differenceInYears, format } from 'date-fns'
import { Search, UserX } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const PLAN_COLORS: Record<string, 'default' | 'info' | 'warning' | 'success' | 'secondary'> = {
  PPO: 'info', HMO: 'default', EPO: 'secondary', MEDICAID: 'warning', MEDICARE: 'success',
}

export function PatientTable() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = trpc.patients.list.useQuery(
    { search: debouncedSearch || undefined, limit: 30 }
  )

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search by name, MRN, email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Patient</TableHead>
            <TableHead>DOB / Age</TableHead>
            <TableHead>Gender</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Insurance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                  ))}
                </TableRow>
              ))
            : data?.patients.map(p => {
                const age = differenceInYears(new Date(), new Date(p.dateOfBirth))
                const coverage = p.coverages?.[0]
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/patients/${p.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium text-gray-900">{p.firstName} {p.lastName}</div>
                      <div className="text-xs text-gray-400">{p.mrn}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{format(new Date(p.dateOfBirth), 'MM/dd/yyyy')}</div>
                      <div className="text-xs text-gray-400">{age}y</div>
                    </TableCell>
                    <TableCell className="text-sm capitalize">{p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : p.gender}</TableCell>
                    <TableCell>
                      <div className="text-sm">{p.phone ?? '—'}</div>
                      <div className="text-xs text-gray-400 truncate max-w-[160px]">{p.email ?? ''}</div>
                    </TableCell>
                    <TableCell>
                      {coverage ? (
                        <div className="space-y-0.5">
                          <div className="text-sm font-medium">{coverage.payer.name}</div>
                          <Badge variant={PLAN_COLORS[coverage.payer.planType] ?? 'secondary'} className="text-xs">
                            {coverage.payer.planType}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">Self-pay</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
        </TableBody>
      </Table>

      {!isLoading && (!data?.patients || data.patients.length === 0) && (
        <div className="flex flex-col items-center py-12 text-center">
          <UserX className="h-10 w-10 text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">
            {debouncedSearch ? `No patients matching "${debouncedSearch}"` : 'No patients found'}
          </p>
        </div>
      )}
    </div>
  )
}
