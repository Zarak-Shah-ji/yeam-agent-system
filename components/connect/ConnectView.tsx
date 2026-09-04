'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { Check, Database, FileSpreadsheet, Lock, ShieldCheck, Trash2, Server } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ImportBox, type ImportResult } from '@/components/imports/ImportBox'
import { NoWorkspace, isNoWorkspace } from '@/components/insights/NoWorkspace'

const CATEGORY_ICON = {
  EHR: Server,
  Database: Database,
  'File feed': FileSpreadsheet,
} as const

/**
 * Where a customer's data comes from.
 *
 * File upload is on every plan and works today. Direct connections are gated,
 * but the gate records the ask rather than being a dead end — a plan wall that
 * cannot be responded to teaches the customer not to ask again.
 */
export function ConnectView() {
  const [imported, setImported] = useState<ImportResult | null>(null)

  const batches = trpc.imports.batches.useQuery()
  const connections = trpc.connections.list.useQuery()
  const utils = trpc.useUtils()

  const deleteBatch = trpc.imports.deleteBatch.useMutation({
    onSuccess: () => {
      void utils.imports.invalidate()
      void utils.insights.invalidate()
      void utils.worklist.invalidate()
    },
  })

  const request = trpc.connections.request.useMutation({
    onSuccess: () => void utils.connections.invalidate(),
  })

  if (isNoWorkspace(batches.error)) return <NoWorkspace />

  function handleImported(result: ImportResult) {
    setImported(result)
    void utils.imports.invalidate()
    void utils.insights.invalidate()
    void utils.worklist.invalidate()
  }

  const requested = new Set((connections.data?.requested ?? []).map(r => r.system))

  return (
    <div className="space-y-6">
      {imported && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-900">
            Imported {imported.imported} {imported.kind === 'claims' ? 'claims' : 'denials'}
            {imported.skipped > 0 && ` · ${imported.skipped} rows skipped`}
          </p>
          {imported.refusedColumns.length > 0 && (
            <p className="mt-1 flex items-start gap-1.5 text-green-800">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Not read or stored: {imported.refusedColumns.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      <section>
        <h2 className="text-base font-semibold text-gray-900">Import a file</h2>
        <p className="mt-1 text-sm text-gray-500">
          Two exports, and the product knows your practice. Neither needs an API or an IT ticket.
        </p>

        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <ImportBox
            profile="denials"
            title="Denials export"
            description="Your denied claims, last 90 days. Becomes your worklist, sorted by filing deadline."
            onImported={handleImported}
          />
          <ImportBox
            profile="claims"
            title="A/R + claims export"
            description="Every claim, paid and unpaid. Gives collection rates, aging and a real denial rate — a denials file alone has no denominator."
            onImported={handleImported}
          />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900">What you have imported</h2>
        <Card className="mt-3">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead>Imported</TableHead>
                  <TableHead>Columns refused</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.isLoading && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                )}

                {!batches.isLoading && (batches.data?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-gray-500">
                      Nothing imported yet.
                    </TableCell>
                  </TableRow>
                )}

                {(batches.data ?? []).map(batch => (
                  <TableRow key={batch.id} className={batch.active ? '' : 'opacity-60'}>
                    <TableCell className="text-sm font-medium text-gray-900">
                      {batch.filename}
                    </TableCell>
                    <TableCell>
                      <Badge variant={batch.kind === 'CLAIMS' ? 'default' : 'outline'}>
                        {batch.kind === 'CLAIMS' ? 'A/R + claims' : 'Denials'}
                      </Badge>
                      {batch.kind === 'CLAIMS' && !batch.active && (
                        <span
                          className="ml-2 text-xs text-gray-500"
                          title="Only your most recent claims snapshot is read, so two exports never double-count"
                        >
                          superseded
                        </span>
                      )}
                      {batch.statusDerived && (
                        <span className="ml-2 text-xs text-amber-700" title="No status column; status inferred from amounts">
                          status estimated
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{batch.rowCount}</TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {format(new Date(batch.createdAt), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell className="max-w-[18rem] truncate text-xs text-gray-500">
                      {batch.droppedColumns.length > 0 ? batch.droppedColumns.join(', ') : '—'}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleteBatch.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${batch.filename} and its ${batch.rowCount} rows? Anything drafted from it goes too.`,
                            )
                          ) {
                            deleteBatch.mutate({ batchId: batch.id })
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-gray-400" aria-hidden="true" />
                        <span className="sr-only">Remove {batch.filename}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">Connect directly</h2>
          {connections.data && !connections.data.unlocked && (
            <Badge variant="outline">
              <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
              Custom plan
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Skip the export entirely and have your denials read on a schedule. Each connection is
          built against a specific system, so it comes with a custom plan — tell us which one and
          we&rsquo;ll get in touch.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(connections.data?.connectors ?? []).map(connector => {
            const Icon = CATEGORY_ICON[connector.category]
            const asked = requested.has(connector.id)
            return (
              <Card key={connector.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Icon className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    {connector.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500">{connector.blurb}</p>
                  {connections.data?.unlocked ? (
                    <Button size="sm" variant="outline" className="mt-3" disabled>
                      Set up
                    </Button>
                  ) : asked ? (
                    <p className="mt-3 flex items-center gap-1.5 text-sm text-green-700">
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Requested — we&rsquo;ll be in touch
                    </p>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      disabled={request.isPending}
                      onClick={() => request.mutate({ system: connector.id })}
                    >
                      Request access
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}
