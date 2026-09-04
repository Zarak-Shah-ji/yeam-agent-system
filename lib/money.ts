/**
 * Prisma Decimal -> number, at the boundary.
 *
 * Decimal is right for storage and wrong for arithmetic in a chart. Convert once
 * where the data leaves the database, never halfway through a calculation.
 */
export function money(value: unknown): number {
  return typeof value === 'object' && value !== null && 'toNumber' in value
    ? (value as { toNumber(): number }).toNumber()
    : Number(value ?? 0)
}
