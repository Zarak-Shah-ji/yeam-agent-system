'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { denialSummary, recordWorkSummary } from '@/lib/claims/section-summary'
import { STATUS_LABEL } from './status'
import { useUsage } from '@/components/shared/use-usage'
import { ClaimBanners, ClaimTitle, DrafterLink } from './detail/ClaimHeader'
import { ClaimHistory } from './detail/ClaimHistory'
import { CodeReviewSection, useCodeReviewSummary } from './detail/CodeReviewSection'
import { MoneyLine } from './detail/MoneyLine'
import { RecordWorkSection } from './detail/RecordWorkSection'
import { Section, SectionSummary } from '@/components/shared/Section'
import { WhyDeniedSection } from './detail/WhyDeniedSection'
import type { ClaimDetail, SectionId } from './detail/types'

/**
 * Everything known about one claim, one part at a time.
 *
 * Follows DraftDialog: the list owns the open id and this reads a single record
 * by it. It is a real query rather than a lookup in the list the table already
 * has, because the history — drafts, submissions, the biller's own events — is
 * not on the wire for the list and would not be worth loading for 200 rows.
 *
 * This used to render the whole record at once: twelve fact cells, a denial
 * card of up to six paragraphs, the code review, a note box, a status select, a
 * follow-up date, two correction inputs and the history, in one scroll with no
 * disclosure anywhere. Nothing was hidden, so nothing was emphasised.
 *
 * Now: who, how much and what has already been done render immediately — the
 * three things that decide whether to go further — and the rest is three
 * collapsed sections, each summarised well enough to skip. Which one is open
 * lives in the URL, so a biller can send a colleague the exact thing they are
 * looking at, not just the claim.
 *
 * AND NOW IT IS MEASURED. Every argument above is an argument, including the
 * good ones. What decides whether this dialog earns the click it costs is what
 * people do once it is open: if almost every claim goes straight on to the
 * drafter with nothing expanded, the right change is not better wording but no
 * dialog. See lib/usage/events.ts — the three events fired here are the whole
 * instrumentation, and they carry no claim and no free text.
 */
export function ClaimDetailDialog({
  claimId,
  open,
  onOpenChange,
  section,
  onSection,
}: {
  claimId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which section is open, from `?open=` — the list owns the URL. */
  section: SectionId | null
  onSection: (id: SectionId | null) => void
}) {
  const detail = trpc.claims.detail.useQuery(
    { id: claimId ?? '' },
    { enabled: Boolean(claimId) && open },
  )
  const claim = (detail.data ?? null) as ClaimDetail | null
  const claimNumber = claim?.claimNumber ?? null

  // Lifted out of the work section only because "Use as correction" in the code
  // review writes into it, and the two are different sections now.
  const [icd10Draft, setIcd10Draft] = useState('')

  const utils = trpc.useUtils()
  const refresh = () => {
    void detail.refetch()
    void utils.insights.invalidate()
  }

  const codeSummary = useCodeReviewSummary(claim?.workable ? claimNumber : null)
  const denial = denialSummary(claim?.denial ?? null)

  /*
    One open, one count. Keyed on the claim id through `once`, so a refetch, a
    window refocus or strict mode's double-invoked effect cannot report two
    visits to one claim — see components/shared/use-usage.ts.

    Fired on the id rather than on the loaded record: a claim whose query fails
    was still opened, and dropping those would quietly bias the denominator
    towards claims that load.
  */
  const usage = useUsage()
  useEffect(() => {
    if (open && claimId) usage.once(claimId, 'CLAIM_OPENED')
  }, [open, claimId, usage])

  /*
    The URL stays the source of truth for which section is open; this only
    watches the traffic on the way past. Counted on opening only — a biller
    closing a section they have read is not a second visit to it.
  */
  const openSection = (id: SectionId | null) => {
    if (id) usage.track('CLAIM_SECTION_OPENED', id)
    onSection(id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <ClaimTitle claim={claim} />
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
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void detail.refetch()}>
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
            <ClaimBanners claim={claim} />
            <MoneyLine
              claim={claim}
              onFigures={() => usage.track('CLAIM_SECTION_OPENED', 'figures')}
            />
            {/* Directly under the line that decides whether to take it. */}
            <DrafterLink claim={claim} onGo={() => usage.track('CLAIM_TO_DRAFTER', 'detail')} />

            <div className="space-y-2">
              {/*
                No reason code, no row. A section that opens onto "nothing to
                show" is exactly the clutter this is removing — an empty row
                still costs a reader the glance.
              */}
              {denial && claim.denial && (
                <Section id="denial" active={section} onSection={openSection}
                  // Reason only. The filing clock is urgency, not diagnosis,
                  // and it now leads the headline above — printing it in both
                  // places made one fact read as two.
                  summary={
                    <SectionSummary
                      label="Why it was denied"
                      preview={
                        <>
                          <span className="font-mono">{denial.code}</span>
                          {denial.label ? ` · ${denial.label}` : ''}
                        </>
                      }
                    />
                  }
                >
                  <WhyDeniedSection denial={claim.denial} />
                </Section>
              )}

              {claim.workable && claimNumber && (
                <Section id="codes" active={section} onSection={openSection}
                  summary={<SectionSummary label="Code review" preview={codeSummary} />}
                >
                  <CodeReviewSection claimNumber={claimNumber} onApplyIcd10={setIcd10Draft} />
                </Section>
              )}

              {claim.workable && claimNumber ? (
                <Section id="work" active={section} onSection={openSection}
                  summary={
                    <SectionSummary
                      label="Record your work"
                      preview={recordWorkSummary(
                        claim.work
                          ? {
                              statusOverride: claim.work.statusOverride,
                              statusLabel: claim.work.statusOverride
                                ? (STATUS_LABEL[claim.work.statusOverride] ?? null)
                                : null,
                              note: claim.work.note,
                              followUpAt: claim.work.followUpAt,
                              lastTouchedAt: claim.work.lastTouchedAt,
                            }
                          : null,
                      )}
                    />
                  }
                >
                  {/*
                    key={claimId}: a fresh mount when a different claim opens,
                    and NOT on a refetch — which is what keeps a refresh from
                    wiping a note somebody is halfway through typing.
                  */}
                  <RecordWorkSection
                    key={claimId}
                    claim={claim}
                    claimNumber={claimNumber}
                    icd10Draft={icd10Draft}
                    onIcd10Draft={setIcd10Draft}
                    onSaved={refresh}
                  />
                </Section>
              ) : (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  This export row has no claim number, so a note or a status cannot be attached to
                  it — there is nothing stable to key the work to, and the next import would lose it.
                </p>
              )}

              {/*
                Last, and closed. The one thing the history decides — whether a
                colleague is already on this — is a clause on the headline now,
                so what is left here is the evidence behind that clause rather
                than the question it answers.
              */}
              <ClaimHistory
                claim={claim}
                onOpen={() => usage.track('CLAIM_SECTION_OPENED', 'history')}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
