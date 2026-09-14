'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CodeReviewPanel } from './CodeReviewPanel'
import { STATUS_LABEL, STATUS_VARIANT } from './status'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const STATUS_OPTIONS = Object.keys(STATUS_LABEL)

function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function day(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'MMM d, yyyy')
}

function Money({ value }: { value: number | null }) {
  return <>{value === null ? '—' : usd.format(value)}</>
}

/** One label/value pair in the facts grid. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children}</dd>
    </div>
  )
}

/**
 * A code as imported, plus what the biller says it should have been.
 *
 * Both, never one: "we billed 99213, it should have been 99214" is the
 * correction, and showing only the corrected value destroys the half a
 * corrected claim is actually built from.
 */
function Code({ imported, corrected }: { imported: string | null; corrected: string | null }) {
  if (!corrected) return <span className="font-mono text-xs">{imported ?? '—'}</span>
  return (
    <span className="font-mono text-xs">
      <span className="text-gray-400 line-through">{imported ?? '—'}</span>{' '}
      <span className="font-semibold text-gray-900">{corrected}</span>
      <span className="ml-1 font-sans text-[11px] font-normal text-gray-500">corrected</span>
    </span>
  )
}

/**
 * Everything known about one claim, and everything that has been done to it.
 *
 * Follows DraftDialog: the list owns the open id and this reads a single record
 * by it. It is a real query rather than a lookup in the list the table already
 * has, because the history — drafts, submissions, the biller's own events — is
 * not on the wire for the list and would not be worth loading for 200 rows.
 *
 * Everything written here goes to ClaimWork, keyed on the claim number, NOT to
 * the OrgClaim row on screen. That row is a snapshot: next month's A/R export
 * replaces it. See server/trpc/router/claims.ts.
 */
export function ClaimDetailDialog({
  claimId,
  open,
  onOpenChange,
}: {
  claimId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const detail = trpc.claims.detail.useQuery(
    { id: claimId ?? '' },
    { enabled: Boolean(claimId) && open },
  )
  const claim = detail.data ?? null

  // Reset on the render that changes claim, not in an effect. The dialog is
  // reused rather than remounted, and an effect keyed on the server value wipes
  // whatever the biller is mid-way through typing when a refetch lands — the
  // same reason RowDetail does this.
  const [shown, setShown] = useState<string | null>(claimId)
  const [note, setNote] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [cpt, setCpt] = useState('')
  const [icd10, setIcd10] = useState('')

  if (shown !== claimId) {
    setShown(claimId)
    setNote(claim?.work?.note ?? '')
    setFollowUp(toDateInput(claim?.work?.followUpAt))
    setCpt('')
    setIcd10('')
  }

  const utils = trpc.useUtils()
  const refresh = () => {
    void detail.refetch()
    void utils.insights.invalidate()
  }

  const setStatus = trpc.claims.setStatus.useMutation({ onSuccess: refresh })
  const saveNote = trpc.claims.setNote.useMutation({ onSuccess: refresh })
  const saveFollowUp = trpc.claims.setFollowUp.useMutation({ onSuccess: refresh })
  const correctCodes = trpc.claims.correctCodes.useMutation({
    onSuccess: () => {
      setCpt('')
      setIcd10('')
      refresh()
    },
  })

  const busy =
    setStatus.isPending || saveNote.isPending || saveFollowUp.isPending || correctCodes.isPending
  const error =
    setStatus.error || saveNote.error || saveFollowUp.error || correctCodes.error

  const claimNumber = claim?.claimNumber ?? null
  const noteChanged = note.trim() !== (claim?.work?.note ?? '').trim()
  const followUpChanged = followUp !== toDateInput(claim?.work?.followUpAt)
  const codesChanged = cpt.trim() !== '' || icd10.trim() !== ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {claim ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{claim.claimNumber ?? 'Claim'}</span>
                <span className="text-sm font-normal text-gray-500">{claim.payer ?? 'Unknown payer'}</span>
                <Badge variant={STATUS_VARIANT[claim.work?.statusOverride ?? claim.status] ?? 'secondary'}>
                  {STATUS_LABEL[claim.work?.statusOverride ?? claim.status] ?? claim.status}
                </Badge>
              </span>
            ) : (
              'Claim'
            )}
          </DialogTitle>
        </DialogHeader>

        {detail.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {/*
          A failed query used to fall through every branch here and render an
          empty modal, which says nothing about what went wrong and reads as a
          broken feature rather than a broken request. Show the reason.
        */}
        {detail.error && (
          <div className="rounded-md bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
            <p className="font-medium">This claim could not be loaded.</p>
            <p className="mt-1">{detail.error.message}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => void detail.refetch()}
            >
              Try again
            </Button>
          </div>
        )}

        {!detail.isLoading && !detail.error && !claim && (
          <p className="rounded-md bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
            That claim is no longer in the current snapshot. A newer A/R export may have replaced it.
          </p>
        )}

        {claim && (
          <div className="space-y-4">
            {/* The biller's status sits next to the imported one, never over it. */}
            {claim.work?.statusOverride && claim.work.statusOverride !== claim.status && (
              <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
                You marked this <strong>{STATUS_LABEL[claim.work.statusOverride]}</strong>. The
                export still says {STATUS_LABEL[claim.status] ?? claim.status} — the next A/R
                snapshot will show whether the payer agrees.
              </p>
            )}

            {claim.snapshot.statusDerived && (
              <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  That export had no status column, so this status was worked out from the amounts.
                </span>
              </p>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Fact label="Billed"><Money value={claim.billed} /></Fact>
              <Fact label="Allowed"><Money value={claim.allowed} /></Fact>
              <Fact label="Paid"><Money value={claim.paid} /></Fact>
              <Fact label="Balance">
                <span className="font-medium">{claim.balance > 0 ? usd.format(claim.balance) : '—'}</span>
              </Fact>
              <Fact label="Patient resp."><Money value={claim.patientResp} /></Fact>
              <Fact label="Adjustment"><Money value={claim.adjustment} /></Fact>
              <Fact label="Service date">{day(claim.serviceDate)}</Fact>
              <Fact label="Submitted">{day(claim.submittedDate)}</Fact>
              <Fact label="Remitted">{day(claim.remitDate)}</Fact>
              <Fact label="Age">
                {claim.ageDays === null
                  ? '—'
                  : `${claim.ageDays} days · ${claim.agingBucket}`}
              </Fact>
              <Fact label="CPT">
                <Code imported={claim.cpt} corrected={claim.work?.correctedCpt ?? null} />
              </Fact>
              <Fact label="ICD-10">
                <Code imported={claim.icd10} corrected={claim.work?.correctedIcd10 ?? null} />
              </Fact>
            </dl>

            {/* What the payer actually said, resolved on read like everything derived. */}
            {claim.denial && (
              <div className="rounded-md border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-gray-900">
                    {claim.denial.code}
                  </span>
                  {claim.denial.remedy && <Badge variant="outline">{claim.denial.remedy}</Badge>}
                  {claim.denial.daysLeft !== null && (
                    <Badge variant={claim.denial.daysLeft <= 14 ? 'destructive' : 'secondary'}>
                      {claim.denial.daysLeft > 0
                        ? `${claim.denial.daysLeft} days to file`
                        : 'Filing window closed'}
                    </Badge>
                  )}
                </div>
                {claim.denial.label && (
                  <p className="mt-1.5 text-sm text-gray-900">{claim.denial.label}</p>
                )}
                {claim.denial.note && (
                  <p className="mt-1 text-sm text-gray-600">{claim.denial.note}</p>
                )}
                {claim.denial.refinement && (
                  <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    {claim.denial.refinement.cause} — {claim.denial.refinement.action}
                  </p>
                )}
                {claim.denial.strategy && (
                  <p className="mt-2 text-sm text-gray-700">
                    <span className="font-medium">What works:</span> {claim.denial.strategy}
                  </p>
                )}
                {claim.denial.avoid && (
                  <p className="mt-1 text-sm text-gray-700">
                    <span className="font-medium">Do not:</span> {claim.denial.avoid}
                  </p>
                )}
              </div>
            )}

            {claim.workable && claimNumber && (
              <CodeReviewPanel claimNumber={claimNumber} onApplyIcd10={setIcd10} />
            )}

            {!claim.workable ? (
              <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
                This export row has no claim number, so a note or a status cannot be attached to it —
                there is nothing stable to key the work to, and the next import would lose it.
              </p>
            ) : (
              <>
                {/* Where the reason the payer gave on the phone lands. */}
                <div>
                  <label
                    htmlFor="claim-note"
                    className="text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    Note
                  </label>
                  <Textarea
                    id="claim-note"
                    rows={3}
                    className="mt-1"
                    placeholder="What the payer said, what you tried, what to do next…"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                  {noteChanged && (
                    <Button
                      size="sm"
                      className="mt-2"
                      disabled={busy}
                      onClick={() => saveNote.mutate({ claimNumber: claimNumber!, note })}
                    >
                      Save note
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 pt-3">
                  <div>
                    <label
                      htmlFor="claim-status"
                      className="text-xs font-medium uppercase tracking-wide text-gray-500"
                    >
                      Status
                    </label>
                    <Select
                      value={claim.work?.statusOverride ?? claim.status}
                      onValueChange={v =>
                        setStatus.mutate({ claimNumber: claimNumber!, status: v as 'PAID' })
                      }
                    >
                      <SelectTrigger id="claim-status" className="mt-1 h-9 w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map(value => (
                          <SelectItem key={value} value={value}>
                            {STATUS_LABEL[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label
                      htmlFor="claim-follow-up"
                      className="text-xs font-medium uppercase tracking-wide text-gray-500"
                    >
                      Follow up
                    </label>
                    <Input
                      id="claim-follow-up"
                      type="date"
                      className="mt-1 h-9 w-44"
                      value={followUp}
                      onChange={e => setFollowUp(e.target.value)}
                    />
                  </div>

                  {followUpChanged && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        saveFollowUp.mutate({
                          claimNumber: claimNumber!,
                          followUpAt: followUp ? new Date(followUp) : null,
                        })
                      }
                    >
                      Save follow-up
                    </Button>
                  )}
                </div>

                {/* A correction sits alongside the imported code, never over it. */}
                <div className="border-t border-gray-200 pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Correct the codes
                  </p>
                  <div className="mt-1 flex flex-wrap items-end gap-2">
                    <Input
                      className="h-9 w-32"
                      placeholder={claim.cpt ?? 'CPT'}
                      aria-label="Corrected CPT"
                      value={cpt}
                      onChange={e => setCpt(e.target.value)}
                    />
                    <Input
                      className="h-9 w-32"
                      placeholder={claim.icd10 ?? 'ICD-10'}
                      aria-label="Corrected ICD-10"
                      value={icd10}
                      onChange={e => setIcd10(e.target.value)}
                    />
                    {codesChanged && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          correctCodes.mutate({
                            claimNumber: claimNumber!,
                            ...(cpt.trim() ? { cpt: cpt.trim() } : {}),
                            ...(icd10.trim() ? { icd10: icd10.trim() } : {}),
                          })
                        }
                      >
                        Save correction
                      </Button>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">
                    Recorded next to what was billed, not over it — a corrected claim needs both.
                  </p>
                </div>
              </>
            )}

            {/* What has actually been done, newest first. */}
            <div className="border-t border-gray-200 pt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">History</p>
                {claim.submissionCount > 0 && (
                  <p className="text-xs text-gray-500">
                    {claim.submissionCount} follow-up{claim.submissionCount === 1 ? '' : 's'} sent to
                    the payer
                  </p>
                )}
              </div>
              <ul className="mt-2 space-y-1.5">
                {claim.timeline.map((entry, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="w-24 shrink-0 text-xs text-gray-500">{day(entry.at)}</span>
                    <span className="min-w-0">
                      <span className="text-gray-900">{entry.label}</span>
                      {entry.detail && <span className="text-gray-500"> — {entry.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {claim.worklistRowId && (
              <div className="border-t border-gray-200 pt-3">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/worklist?row=${claim.worklistRowId}`}>
                    Open in the drafter
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
                {claim.draftCount > 0 && (
                  <span className="ml-2 text-xs text-gray-500">
                    {claim.draftCount} draft{claim.draftCount === 1 ? '' : 's'} written
                  </span>
                )}
              </div>
            )}

            {busy && (
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </p>
            )}

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error.message}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
