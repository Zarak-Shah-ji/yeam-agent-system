'use client'

import { trpc } from '@/lib/trpc/client'
import { CodeReviewPanel } from '../CodeReviewPanel'
import { codeReviewSummary } from '@/lib/claims/section-summary'

/**
 * The claim's codes, and what this practice's own settled history says about
 * them.
 *
 * The signals query lives here rather than only inside CodeReviewPanel so the
 * collapsed summary can state real figures — the codes and the paid rate with
 * its sample size — instead of the word "Codes". It is free: computed from rows
 * already in the database, no model call and no API key. React Query dedupes it
 * against the panel's identical query, so opening the section costs nothing
 * extra.
 */
export function useCodeReviewSummary(claimNumber: string | null) {
  const signals = trpc.claims.signals.useQuery(
    { claimNumber: claimNumber ?? '' },
    { enabled: Boolean(claimNumber) },
  )

  const s = signals.data?.signals
  return codeReviewSummary({
    cpt: s?.cpt ?? null,
    icd10: s?.icd10 ?? null,
    history: s?.history ? { n: s.history.n, paidRate: s.history.paidRate } : null,
    loading: signals.isLoading,
  })
}

export function CodeReviewSection({
  claimNumber,
  onApplyIcd10,
}: {
  claimNumber: string
  onApplyIcd10: (code: string) => void
}) {
  return <CodeReviewPanel claimNumber={claimNumber} onApplyIcd10={onApplyIcd10} />
}
