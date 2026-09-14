import { describe, it, expect } from 'vitest'
import { AGING_BUCKETS, agingBucketRange, bucketFor, daysBetween } from '@/lib/insights/aggregate'

/**
 * The claims table filters to an aging bucket in SQL; the aging chart buckets
 * the same claims in memory. Two implementations of "61-90 days" that disagree
 * by a day is the kind of thing a customer only finds when a total refuses to
 * reconcile, so they are pinned to each other here.
 */

const TODAY = new Date(2026, 8, 6) // 2026-09-06, local — daysBetween is local-midnight based

function daysAgo(n: number): Date {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - n)
  return d
}

function inRange(anchor: Date, range: { from: Date | null; to: Date | null }): boolean {
  if (range.from && anchor < range.from) return false
  if (range.to && anchor > range.to) return false
  return true
}

describe('agingBucketRange is the inverse of bucketFor', () => {
  it.each(AGING_BUCKETS)('%s selects exactly the claims the chart puts in it', bucket => {
    const range = agingBucketRange(bucket, TODAY)
    // Well past the last boundary, so every bucket edge is crossed twice.
    for (let age = -5; age <= 200; age++) {
      const anchor = daysAgo(age)
      const charted = bucketFor(daysBetween(anchor, TODAY)) === bucket
      expect({ age, selected: inRange(anchor, range) }).toEqual({ age, selected: charted })
    }
  })

  it('ages a future service date as 0-30, the way the chart does', () => {
    // A service date dated ahead is a data-entry artefact, not a 120+ receivable.
    expect(bucketFor(daysBetween(daysAgo(-10), TODAY))).toBe('0-30')
    expect(inRange(daysAgo(-10), agingBucketRange('0-30', TODAY))).toBe(true)
  })

  it('puts every claim in exactly one bucket', () => {
    for (let age = -5; age <= 200; age++) {
      const anchor = daysAgo(age)
      const hits = AGING_BUCKETS.filter(b => inRange(anchor, agingBucketRange(b, TODAY)))
      expect({ age, hits: hits.length }).toEqual({ age, hits: 1 })
    }
  })
})
