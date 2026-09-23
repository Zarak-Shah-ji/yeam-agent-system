import Link from 'next/link'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { STATUS_LABEL, STATUS_VARIANT } from '../status'
import type { ClaimDetail } from './types'

/** The two things that qualify the status before anything is read into it. */
export function ClaimBanners({ claim }: { claim: ClaimDetail }) {
  return (
    <>
      {/* The biller's status sits next to the imported one, never over it. */}
      {claim.work?.statusOverride && claim.work.statusOverride !== claim.status && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
          You marked this <strong>{STATUS_LABEL[claim.work.statusOverride]}</strong>. The export
          still says {STATUS_LABEL[claim.status] ?? claim.status} — the next A/R snapshot will show
          whether the payer agrees.
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
    </>
  )
}

/** Who and what, in the dialog title. */
export function ClaimTitle({ claim }: { claim: ClaimDetail | null }) {
  if (!claim) return <>Claim</>
  const status = claim.work?.statusOverride ?? claim.status
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono">{claim.claimNumber ?? 'Claim'}</span>
      <span className="text-sm font-normal text-gray-500">{claim.payer ?? 'Unknown payer'}</span>
      <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>
        {STATUS_LABEL[status] ?? status}
      </Badge>
    </span>
  )
}

/**
 * The way out of the record and into the work.
 *
 * It used to sit at the bottom of the history block, which put the one thing a
 * biller is most likely to want next underneath the list they were least likely
 * to read. It is the primary action on any claim that has a denial row, so it
 * is now directly under the headline that decides whether to take it.
 *
 * Renders nothing when there is no row in the drafter — the claim was never
 * denied, or the denials export has not caught up with the A/R one. An action
 * that leads somewhere empty is worse than no action.
 */
export function DrafterLink({
  claim,
  onGo,
}: {
  claim: ClaimDetail
  /** Fired on the way out. See components/shared/use-usage.ts. */
  onGo?: () => void
}) {
  if (!claim.worklistRowId) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild size="sm">
        <Link href={`/worklist?row=${claim.worklistRowId}`} onClick={() => onGo?.()}>
          Open in the drafter
          <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </Button>
      {claim.draftCount > 0 && (
        <span className="text-xs text-gray-500">
          {claim.draftCount} draft{claim.draftCount === 1 ? '' : 's'} written
        </span>
      )}
    </div>
  )
}
