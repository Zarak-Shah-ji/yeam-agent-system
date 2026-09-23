'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, ExternalLink } from 'lucide-react'
import { trpc } from '@/lib/trpc/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Fact } from '@/components/claims/detail/atoms'
import { Section, SectionSummary } from '@/components/shared/Section'
import { UNKNOWN_PAYER } from '@/lib/billing/payer-key'
import { pct, usd } from '@/lib/charts/format'
import {
  appealsSummary,
  channelLine,
  payerHeadline,
  paymentsSummary,
  reasonsSummary,
  sendSummary,
} from '@/lib/insights/payer-summary'
import { MIN_SAMPLE } from '@/lib/stats/min-sample'
import type { ResolvedDestination } from '@/lib/billing/submission'
import type { OutcomeGroup } from '@/lib/denials/outcomes'
import type { PayerReason, PayerRow } from '@/lib/insights/aggregate'

/** Which section is open. Mirrors the `?open=` values on /payers. */
export type PayerSectionId = 'reasons' | 'payments' | 'appeals' | 'send'
export const PAYER_SECTIONS: readonly PayerSectionId[] = ['reasons', 'payments', 'appeals', 'send']

/** Reasons shown before the list becomes a scroll. The rest are one click on. */
const REASONS = 5

/**
 * One payer, the way a biller actually reads one.
 *
 * This first shipped as a wall: eleven figure tiles of equal weight, a reasons
 * table, the appeal record, the send-to block and an explanatory sentence under
 * every heading, with the denial rate, the at-stake money and days-to-pay each
 * printed twice. It answered every question at once, so it answered none of
 * them first.
 *
 * It now follows the claim panel. A payer is opened to decide one thing — is
 * there money to go and get from them, and is any of it about to be lost — so
 * that is the headline, with the action that follows from it directly
 * underneath. Everything else is a collapsed row that states its own finding,
 * so "why do they deny", "how do they pay", "does appealing them work" and
 * "where does it go" can each be answered from the summary line without
 * opening anything:
 *
 *   Why they deny   CO-197 · Precertification absent · 7 more
 *   How they pay    Deny 5.4% of 240 claims · typically pay in 32 days
 *   Appeals         Won 3 of 4 rulings — too few to judge
 *   Where to send   Portal · TexMedConnect · check before sending
 *
 * A section with nothing to say is not rendered at all, rather than opening
 * onto "no data".
 *
 * Which section is open lives in the URL, as it does for claims, so a link to a
 * colleague lands on the payer and the part being discussed.
 *
 * The three sources stay apart: the headline and the reasons are the denial
 * worklist, "how they pay" is the A/R snapshot, appeals are the outcome ledger.
 * No figure here is the sum of two of them.
 */
export function PayerDetailDialog({
  row,
  outcomes,
  open,
  onOpenChange,
  section,
  onSection,
}: {
  row: PayerRow | null
  /** This payer's appeal history, or null where nothing has been sent to them. */
  outcomes: OutcomeGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
  section: PayerSectionId | null
  onSection: (id: PayerSectionId | null) => void
}) {
  const payer = row?.payer ?? ''
  const addressable = Boolean(payer) && payer !== UNKNOWN_PAYER
  const detail = trpc.insights.payerDetail.useQuery(
    { payer },
    { enabled: open && addressable },
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row?.payer ?? 'Payer'}</DialogTitle>
        </DialogHeader>

        {row && (
          <div className="space-y-4">
            <Headline row={row} />
            <Actions row={row} />
            <PayerSections
              row={row}
              outcomes={outcomes}
              destination={detail.data?.destination ?? null}
              destinationLoading={addressable && detail.isLoading}
              addressable={addressable}
              section={section}
              onSection={onSection}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The money, and the only clauses allowed to shout.
 *
 * Same shape as the claim panel's money line: one large figure, one quiet line
 * of context, and red reserved for money that is about to be lost or already
 * has been.
 */
function Headline({ row }: { row: PayerRow }) {
  const h = payerHeadline(row)
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {h.amount !== null ? (
          <>
            <span className="text-3xl font-bold tabular-nums text-gray-900">{usd(h.amount)}</span>
            <span className="text-sm text-gray-500">{h.lead}</span>
          </>
        ) : (
          <span className="text-2xl font-semibold text-gray-900">{h.lead}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">{h.context.join(' · ')}</p>
      {h.urgent.length > 0 && (
        <p className="mt-0.5 text-sm font-medium text-red-700">{h.urgent.join(' · ')}</p>
      )}
    </div>
  )
}

/**
 * The ways out of the record and into the work, under the figure that decides
 * whether to take them. Each renders only where it leads somewhere.
 */
function Actions({ row }: { row: PayerRow }) {
  if (row.openDenials === 0 && row.claims === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {row.openDenials > 0 && (
        <Button asChild size="sm">
          <Link href={`/worklist?q=${encodeURIComponent(row.payer)}`}>
            Work these denials
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      )}
      {row.claims > 0 && (
        <Link
          href={`/claims?payer=${encodeURIComponent(row.payer)}`}
          className="text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
        >
          See all {row.claims} claims
        </Link>
      )}
    </div>
  )
}

function PayerSections({
  row,
  outcomes,
  destination,
  destinationLoading,
  addressable,
  section,
  onSection,
}: {
  row: PayerRow
  outcomes: OutcomeGroup | null
  destination: ResolvedDestination | null
  destinationLoading: boolean
  addressable: boolean
  section: PayerSectionId | null
  onSection: (id: PayerSectionId | null) => void
}) {
  const reasons = reasonsSummary(row.reasons)
  const payments = paymentsSummary(row)
  const appeals = appealsSummary(outcomes)

  return (
    <div className="space-y-2">
      {reasons && (
        <Section
          id="reasons"
          active={section}
          onSection={onSection}
          summary={
            <SectionSummary
              label="Why they deny"
              preview={
                <>
                  <span className="font-mono">{reasons.carc}</span> · {reasons.label}
                  {reasons.more > 0 && (
                    <span className="text-gray-500"> · {reasons.more} more</span>
                  )}
                </>
              }
            />
          }
        >
          <ReasonList reasons={row.reasons} />
        </Section>
      )}

      {payments && (
        <Section
          id="payments"
          active={section}
          onSection={onSection}
          summary={<SectionSummary label="How they pay" preview={payments} />}
        >
          <Payments row={row} />
        </Section>
      )}

      {appeals && outcomes && (
        <Section
          id="appeals"
          active={section}
          onSection={onSection}
          summary={<SectionSummary label="Appeals" preview={appeals} />}
        >
          <Appeals outcomes={outcomes} />
        </Section>
      )}

      {addressable && (
        <Section
          id="send"
          active={section}
          onSection={onSection}
          summary={
            <SectionSummary
              label="Where to send"
              preview={sendSummary(destination, destinationLoading)}
            />
          }
        >
          {destinationLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : (
            <Destination destination={destination} />
          )}
        </Section>
      )}
    </div>
  )
}

/** Every reason on the worklist for this payer, most frequent first. */
function ReasonList({ reasons }: { reasons: PayerReason[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? reasons : reasons.slice(0, REASONS)
  const hidden = reasons.length - shown.length

  return (
    <div>
      <ul className="divide-y divide-gray-100">
        {shown.map(reason => (
          <li key={reason.carc} className="flex items-baseline gap-3 py-1.5">
            <span className="w-16 shrink-0 font-mono text-xs text-gray-900">{reason.carc}</span>
            <span className="min-w-0 flex-1 text-sm text-gray-700">{reason.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-gray-500">
              {reason.count} · {usd(reason.billed)}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-1.5 text-xs font-medium text-blue-600 underline"
        >
          {hidden} more
        </button>
      )}
      <p className="mt-2 text-xs text-gray-400">Open denials on your worklist · count · billed</p>
    </div>
  )
}

/**
 * The A/R snapshot's view of this payer. Every rate names what it was taken
 * over, including the net collection rate, whose denominator — allowed — is
 * the figure people most often mistake for billed.
 */
function Payments({ row }: { row: PayerRow }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Fact label="Billed">
          {usd(row.billed)}{' '}
          <span className="text-xs text-gray-500">on {row.claims} claims</span>
        </Fact>
        <Fact label="Collected">
          {usd(row.paid)}{' '}
          <span className="text-xs text-gray-500">{pct(row.grossCollectionRate)} of billed</span>
        </Fact>
        <Fact label="Net collection">
          {pct(row.netCollectionRate)}{' '}
          <span className="text-xs text-gray-500">of {usd(row.allowed)} allowed</span>
        </Fact>
        <Fact label="Denied">
          {row.denied} of {row.claims}{' '}
          <span className="text-xs text-gray-500">{pct(row.denialRate)}</span>
        </Fact>
        <Fact label="Days to pay">
          {row.medianDaysToPay === null ? '—' : `${row.medianDaysToPay} days`}{' '}
          <span className="text-xs text-gray-500">median</span>
        </Fact>
        <Fact label="Still unpaid">{usd(row.outstanding)}</Fact>
      </dl>
      <p className="mt-3 text-xs text-gray-400">
        From your latest A/R export — every claim to this payer, paid or not.
      </p>
    </div>
  )
}

/**
 * What came back from this payer, beyond the line that summarises it.
 *
 * Only the facts that say something: a zero "never answered" or "$0 recovered"
 * is a row the reader has to read to learn nothing, and the won-of-decided
 * count is already on the summary line above.
 */
function Appeals({ outcomes }: { outcomes: OutcomeGroup }) {
  const facts: { label: string; value: string }[] = []
  if (outcomes.recovered > 0) facts.push({ label: 'Recovered', value: usd(outcomes.recovered) })
  // A median over a handful of rulings is the same anecdote a rate would be,
  // so it waits for the same floor — as it does on the Analytics card.
  if (outcomes.medianDays !== null && outcomes.decided >= MIN_SAMPLE) {
    facts.push({ label: 'Time to a ruling', value: `${outcomes.medianDays} days, median` })
  }
  if (outcomes.partial > 0) facts.push({ label: 'Paid in part', value: String(outcomes.partial) })
  if (outcomes.denied > 0) facts.push({ label: 'Denied again', value: String(outcomes.denied) })
  if (outcomes.pending > 0) facts.push({ label: 'Waiting', value: String(outcomes.pending) })
  if (outcomes.noResponse > 0) {
    facts.push({ label: 'Never answered', value: String(outcomes.noResponse) })
  }

  return (
    <div>
      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {facts.map(f => (
            <Fact key={f.label} label={f.label}>
              {f.value}
            </Fact>
          ))}
        </dl>
      )}
      {outcomes.decided > 0 && outcomes.decided < MIN_SAMPLE && (
        <p className={`${facts.length > 0 ? 'mt-3' : ''} flex items-start gap-1.5 text-xs text-amber-700`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Fewer than {MIN_SAMPLE} rulings — read this as an anecdote, not a rate.
        </p>
      )}
    </div>
  )
}

function Destination({ destination }: { destination: ResolvedDestination | null }) {
  if (!destination || destination.options.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        Nothing saved for this payer. Add their appeals channel in Settings → Payer destinations
        and every draft for them will carry it.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {destination.options.map((option, i) => (
        <div key={`${option.channel}-${i}`} className="flex flex-wrap items-baseline gap-2">
          {i === 0 && <Badge variant="info">Preferred</Badge>}
          {option.url ? (
            <a
              href={option.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
            >
              {channelLine(option, destination.ediPayerId)}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : (
            <span className="whitespace-pre-line text-sm text-gray-700">
              {option.channel === 'MAIL' ? option.label : channelLine(option, destination.ediPayerId)}
            </span>
          )}
        </div>
      ))}
      {destination.requiredFormNote && (
        <p className="text-xs text-gray-600">{destination.requiredFormNote}</p>
      )}
      {destination.needsVerification && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          From our payer panel, not from you. Check it against their current provider manual
          before anything is sent.
        </p>
      )}
    </div>
  )
}
