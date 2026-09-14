/**
 * How a claim status is shown.
 *
 * Shared between the table and the detail dialog because they had two copies of
 * the same maps, and a status that reads "Written off" in one place and
 * "WRITTEN_OFF" in the other is the sort of thing nobody notices until a
 * customer screenshots it. Note these are OrgClaim statuses — the worklist has
 * its own, identically named and deliberately different.
 */

export const STATUS_VARIANT: Record<
  string,
  'default' | 'success' | 'warning' | 'secondary' | 'destructive' | 'outline'
> = {
  PAID: 'success',
  PARTIAL: 'warning',
  DENIED: 'destructive',
  PENDING: 'default',
  REJECTED: 'destructive',
  WRITTEN_OFF: 'secondary',
  UNKNOWN: 'secondary',
}

export const STATUS_LABEL: Record<string, string> = {
  PAID: 'Paid',
  PARTIAL: 'Partial',
  DENIED: 'Denied',
  PENDING: 'Pending',
  REJECTED: 'Rejected',
  WRITTEN_OFF: 'Written off',
  UNKNOWN: 'Unknown',
}
