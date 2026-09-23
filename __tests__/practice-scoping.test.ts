import { describe, it, expect } from 'vitest'
import { practiceScope } from '@/lib/practices/scope'
import { practiceIdentity, PRACTICE_IDENTITY_SELECT } from '@/lib/practices/identity'

/**
 * Which rows a biller can see once a billing company runs several clinics.
 *
 * The rule under test is the asymmetry: a missing ORG refuses the request, a
 * missing or stale PRACTICE widens it. That is deliberate and it is the reason
 * practices are a child of the organization rather than a tenant of their own —
 * under this design a forgotten practice filter shows a company its own other
 * clinic, where under a multi-org membership table the same slip would be a
 * cross-customer leak.
 *
 * `activePracticeId` is a user-writable column, so every case here is really
 * asking the same question: what happens when the value cannot be trusted.
 */

const ORG = 'org_a'
const OTHER_ORG = 'org_b'

describe('practiceScope', () => {
  it('is {} when no practice is chosen', () => {
    const scope = practiceScope(null, null, ORG)
    expect(scope.practiceWhere).toEqual({})
    expect(scope.practiceId).toBeNull()
    expect(scope.reason).toBe('combined')
  })

  it('is { practiceId } when one is active and belongs to the org', () => {
    const scope = practiceScope('p1', { id: 'p1', orgId: ORG, archivedAt: null }, ORG)
    expect(scope.practiceWhere).toEqual({ practiceId: 'p1' })
    expect(scope.practiceId).toBe('p1')
    expect(scope.reason).toBe('isolated')
  })

  it('is {} when the id does not belong to the org', () => {
    // The case that matters. Someone writes another workspace's practice id
    // into their own column; the lookup finds a real row, and the check that
    // saves us is the one against ctx.orgId, not the one against existence.
    const scope = practiceScope('p1', { id: 'p1', orgId: OTHER_ORG, archivedAt: null }, ORG)
    expect(scope.practiceWhere).toEqual({})
    expect(scope.practiceId).toBeNull()
    expect(scope.reason).toBe('stale')
  })

  it('is {} when the id names nothing at all', () => {
    const scope = practiceScope('deleted', null, ORG)
    expect(scope.practiceWhere).toEqual({})
    expect(scope.reason).toBe('stale')
  })

  it('is {} when the practice has been archived', () => {
    // An admin archiving a clinic must not lock out whoever had it selected.
    const scope = practiceScope('p1', { id: 'p1', orgId: ORG, archivedAt: new Date() }, ORG)
    expect(scope.practiceWhere).toEqual({})
    expect(scope.reason).toBe('stale')
  })

  it('never throws, on any input', () => {
    // Spelled out because the tempting fix for every case above is a 403, and a
    // 403 here is a biller staring at an error page over a setting they cannot
    // see. Widening is the correct failure.
    expect(() => practiceScope(undefined, null, ORG)).not.toThrow()
    expect(() => practiceScope('', null, ORG)).not.toThrow()
    expect(() => practiceScope('x', undefined, ORG)).not.toThrow()
  })

  it('distinguishes a deliberate combined view from a broken one', () => {
    // Only one of these is worth telling someone about.
    expect(practiceScope(null, null, ORG).reason).toBe('combined')
    expect(practiceScope('gone', null, ORG).reason).toBe('stale')
  })

  it('returns a fragment that carries no orgId', () => {
    // It is spread into a where clause that supplies the org filter. If this
    // ever grew one, a call site would look scoped while being scoped twice —
    // and worse, one that dropped the org filter would look fine.
    const scope = practiceScope('p1', { id: 'p1', orgId: ORG, archivedAt: null }, ORG)
    expect(Object.keys(scope.practiceWhere)).toEqual(['practiceId'])
  })
})

describe('practiceIdentity', () => {
  const org = { practiceName: 'Billing Co', npi: '111', city: 'Austin', contactFax: '555-0100' }
  const clinic = { name: 'Riverside', practiceName: 'Riverside Family Medicine', npi: '222' }

  it('signs with the practice when the row has one', () => {
    const id = practiceIdentity(clinic, org)
    expect(id.practiceName).toBe('Riverside Family Medicine')
    expect(id.source).toBe('practice')
    expect(id.practiceLabel).toBe('Riverside')
  })

  it('does NOT borrow missing fields from the organization', () => {
    // The whole point. Riverside has no fax; it must not inherit the billing
    // company's. A letterhead that is half one clinic and half another is worse
    // than a missing line, because it is wrong in a way that looks complete.
    const id = practiceIdentity(clinic, org)
    expect(id.contactFax).toBeNull()
    expect(id.city).toBeNull()
  })

  it('falls back to the organization when no practice is assigned', () => {
    const id = practiceIdentity(null, org)
    expect(id.practiceName).toBe('Billing Co')
    expect(id.source).toBe('organization')
  })

  it('falls back when the practice row exists but is entirely blank', () => {
    // Created in settings, never filled in. An empty block helps nobody, and
    // the org's is what the workspace was signing with yesterday.
    const id = practiceIdentity({ name: 'New clinic' }, org)
    expect(id.practiceName).toBe('Billing Co')
    expect(id.source).toBe('organization')
  })

  it('resolves to nothing when neither is filled in', () => {
    // draft-response.ts keys its "sign [PRACTICE NAME]" branch on a null
    // practiceName, so this is the input that keeps the placeholder.
    const id = practiceIdentity(null, null)
    expect(id.practiceName).toBeNull()
    expect(id.source).toBe('none')
  })

  it('treats whitespace as absent', () => {
    const id = practiceIdentity({ name: 'x', practiceName: '   ' }, org)
    expect(id.source).toBe('organization')
  })

  it('answers for all twelve fields whichever record wins', () => {
    // A partial result would let a caller read a field that silently came from
    // the other record.
    const id = practiceIdentity(clinic, org)
    for (const key of Object.keys(PRACTICE_IDENTITY_SELECT)) {
      expect(id).toHaveProperty(key)
    }
  })
})
