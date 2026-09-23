import { describe, it, expect } from 'vitest'
import { DENIAL_STATUSES, STATUS_LABEL, statusLabel } from '@/lib/denials/status'

describe('denial status labels', () => {
  it('labels every status the schema allows', () => {
    for (const status of DENIAL_STATUSES) {
      expect(STATUS_LABEL[status], status).toBeTruthy()
    }
  })

  it('speaks the biller\'s language, not the enum\'s', () => {
    // These two are the reason the map exists: a row is "Recovered", not "PAID".
    expect(statusLabel('PAID')).toBe('Recovered')
    expect(statusLabel('DEAD')).toBe('Written off')
  })

  it('falls back to the raw value rather than rendering blank', () => {
    expect(statusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })
})
