import { Badge } from '@/components/ui/badge'
import type { ClaimDetail } from './types'

/**
 * What the payer actually said, and what is known to work against it.
 *
 * Up to six paragraphs and two badges, which is why it is behind a summary
 * line: it is the densest thing in the record and it is only read when the
 * claim is actually being worked.
 */
export function WhyDeniedSection({ denial }: { denial: NonNullable<ClaimDetail['denial']> }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-gray-900">{denial.code}</span>
        {denial.remedy && <Badge variant="outline">{denial.remedy}</Badge>}
        {denial.daysLeft !== null && (
          <Badge variant={denial.daysLeft <= 14 ? 'destructive' : 'secondary'}>
            {denial.daysLeft > 0 ? `${denial.daysLeft} days to file` : 'Filing window closed'}
          </Badge>
        )}
      </div>

      {denial.label && <p className="mt-1.5 text-sm text-gray-900">{denial.label}</p>}
      {denial.note && <p className="mt-1 text-sm text-gray-600">{denial.note}</p>}

      {denial.refinement && (
        <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {denial.refinement.cause} — {denial.refinement.action}
        </p>
      )}

      {denial.strategy && (
        <p className="mt-2 text-sm text-gray-700">
          <span className="font-medium">What works:</span> {denial.strategy}
        </p>
      )}
      {denial.avoid && (
        <p className="mt-1 text-sm text-gray-700">
          <span className="font-medium">Do not:</span> {denial.avoid}
        </p>
      )}

      {/* Where the filing clock came from. A countdown with no provenance is a
          number a biller cannot check, and this one decides whether a claim is
          worth working at all. */}
      <p className="mt-2 text-xs text-gray-500">
        Filing window: {denial.filingWindowDays} days ({denial.filingWindowSource}).
      </p>
    </div>
  )
}
