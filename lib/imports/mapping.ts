/**
 * Matching an upload's headers onto a profile's fields.
 *
 * Generic over the profile's field union so the denials export and the A/R
 * export share one mapping engine instead of two that drift. A profile supplies
 * its own pattern list and required set; everything below is field-agnostic.
 *
 * The de-identification veto is not a parameter. It is imported from
 * lib/imports/deidentify.ts and applied to every profile, so a new profile
 * cannot opt out of it by forgetting to pass something.
 */

import { isIgnorableColumn } from './deidentify'

/** [field, pattern] pairs, most specific first. */
export type HeaderPattern<F extends string> = [F, RegExp]

export type Mapping<F extends string> = Partial<Record<F, number>>

/**
 * First non-ignorable header matching each pattern wins.
 *
 * Fields already assigned are skipped, which is what lets a profile list the
 * same field twice to express precedence — a remittance date beats a service
 * date for deadline purposes, so it is matched ahead of the DOS fallback.
 *
 * A header is claimed by at most one field. Without that, "Paid Date" in an A/R
 * export matches both the remit-date pattern and the paid-amount pattern, and
 * the money column silently becomes a date. Earlier patterns win, so a profile
 * orders its list most-specific-first and gets exclusivity for free.
 */
export function detectMapping<F extends string>(
  headers: string[],
  patterns: readonly HeaderPattern<F>[],
): Mapping<F> {
  const mapping: Mapping<F> = {}
  const claimed = new Set<number>()
  for (const [field, pattern] of patterns) {
    if (mapping[field] !== undefined) continue
    const idx = headers.findIndex(
      (h, i) => !claimed.has(i) && pattern.test(h ?? '') && !isIgnorableColumn(h ?? ''),
    )
    if (idx >= 0) {
      mapping[field] = idx
      claimed.add(idx)
    }
  }
  return mapping
}

export function missingRequired<F extends string>(
  mapping: Mapping<F>,
  required: readonly F[],
): F[] {
  return required.filter(f => mapping[f] === undefined)
}

/**
 * A reader for mapped cells. Returns "" for any field the profile did not map,
 * so callers can treat "absent column" and "empty cell" identically.
 */
export function cellReader<F extends string>(mapping: Mapping<F>) {
  return (row: string[], field: F): string => {
    const idx = mapping[field]
    return idx === undefined ? '' : (row[idx] ?? '').trim()
  }
}

export type ColumnReport = {
  /** Headers carrying identifiers. Named back to the user, never read. */
  refused: string[]
  /** Headers we simply had no use for. */
  unused: string[]
}

/**
 * What the parser refused to read, so the import summary can say so.
 *
 * Showing this is the point. "4 columns ignored: Patient Name, Member ID, DOB"
 * turns a constraint we are under anyway into the reason a billing manager
 * trusts the upload box.
 */
export function reportColumns<F extends string>(
  headers: string[],
  mapping: Mapping<F>,
): ColumnReport {
  const used = new Set<number>(Object.values(mapping) as number[])
  const refused: string[] = []
  const unused: string[] = []

  headers.forEach((header, index) => {
    const name = (header ?? '').trim()
    if (!name || used.has(index)) return
    if (isIgnorableColumn(name)) refused.push(name)
    else unused.push(name)
  })

  return { refused, unused }
}

/**
 * Apply a user's column overrides from the import preview on top of what
 * detection found.
 *
 * An override naming an identifier column is dropped rather than honoured — the
 * de-identification promise is not the customer's to waive through a dropdown.
 * Returns the surviving mapping plus anything it refused, so the UI can say why
 * a choice did not stick.
 */
export function applyOverrides<F extends string>(
  detected: Mapping<F>,
  overrides: Partial<Record<F, number>>,
  headers: string[],
  validFields: readonly F[],
): { mapping: Mapping<F>; refusedOverrides: string[] } {
  const mapping: Mapping<F> = { ...detected }
  const refusedOverrides: string[] = []

  for (const [field, index] of Object.entries(overrides) as [F, number | undefined][]) {
    if (!validFields.includes(field)) continue
    if (index === undefined || index === null || index < 0) {
      delete mapping[field]
      continue
    }
    if (index >= headers.length) continue
    if (isIgnorableColumn(headers[index] ?? '')) {
      refusedOverrides.push(headers[index])
      continue
    }
    mapping[field] = index
  }

  return { mapping, refusedOverrides }
}
