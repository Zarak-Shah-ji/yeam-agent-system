import { describe, expect, it } from 'vitest'
import { usdCompact } from '@/lib/charts/format'

describe('usdCompact', () => {
  it('keeps one decimal under $10k, so neighbouring ticks and bars do not collide', () => {
    expect(usdCompact(1600)).toBe('$1.6k')
    expect(usdCompact(2400)).toBe('$2.4k')
    expect(usdCompact(2548)).toBe('$2.5k')
    expect(usdCompact(3191)).toBe('$3.2k')
  })

  it('drops a trailing .0 rather than printing $2.0k', () => {
    expect(usdCompact(2000)).toBe('$2k')
  })

  it('rounds to whole thousands from $10k and to millions past that', () => {
    expect(usdCompact(12_400)).toBe('$12k')
    expect(usdCompact(1_250_000)).toBe('$1.3M')
    expect(usdCompact(12_000_000)).toBe('$12M')
  })

  it('prints small amounts whole', () => {
    expect(usdCompact(455)).toBe('$455')
    expect(usdCompact(0)).toBe('$0')
  })
})
