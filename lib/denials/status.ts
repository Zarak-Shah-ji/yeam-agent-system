/**
 * What a denial row's status is called, in one place.
 *
 * This map used to live inside components/worklist/RowDetail.tsx and be
 * re-exported from there. That was fine while only the table and the work panel
 * needed it, and stopped being fine the moment the server had to write a
 * human-readable status into a timeline event: importing it from a client
 * component would pull React into the tRPC router's bundle.
 *
 * The labels are not the enum. "PAID" is "Recovered" and "DEAD" is "Written
 * off", because a biller is looking at their own work, not at a state machine.
 */

export const DENIAL_STATUSES = ['TO_WORK', 'DRAFTED', 'SENT', 'PAID', 'DEAD'] as const

export type DenialStatus = (typeof DENIAL_STATUSES)[number]

export const STATUS_LABEL: Record<string, string> = {
  TO_WORK: 'To work',
  DRAFTED: 'Drafted',
  SENT: 'Sent',
  PAID: 'Recovered',
  DEAD: 'Written off',
}

/** Falls back to the raw value so an unmapped status shows as itself, not blank. */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}
