import { describe, it, expect } from 'vitest'
import {
  PANE_LABEL,
  PANE_STAGE,
  STAGES_WITHOUT_PANE,
  WORK_PANES,
  furthestReachablePane,
  isWorkPane,
  nextPane,
  paneClickable,
  paneReachable,
  prevPane,
  type PaneAvailability,
} from '@/lib/denials/panes'
import { STAGES } from '@/lib/denials/stages'

/**
 * The panel shows one pane at a time, so where you can go is now a rule rather
 * than a scroll position. These are the ways it could strand somebody: a pane
 * with nothing in it, a Next that leads nowhere, a Back that refuses.
 */

const NOTHING: PaneAvailability = { hasDraft: false, hasSubmission: false }
const DRAFTED: PaneAvailability = { hasDraft: true, hasSubmission: false }
const SENT: PaneAvailability = { hasDraft: true, hasSubmission: true }

describe('reachability', () => {
  it('always lets you reach the note and the letter', () => {
    // The letter pane is where a letter gets written. Gating it on a letter
    // existing would make it unreachable forever.
    for (const available of [NOTHING, DRAFTED, SENT]) {
      expect(paneReachable('note', available)).toBe(true)
      expect(paneReachable('draft', available)).toBe(true)
    }
  })

  it('opens send only once a letter exists', () => {
    expect(paneReachable('send', NOTHING)).toBe(false)
    expect(paneReachable('send', DRAFTED)).toBe(true)
  })

  it('opens outcome only once something has gone out', () => {
    expect(paneReachable('outcome', DRAFTED)).toBe(false)
    expect(paneReachable('outcome', SENT)).toBe(true)
  })

  it('gates on what exists, not on the row status', () => {
    // A row marked SENT by hand with no draft on it has nothing to send. This
    // is why availability is two booleans and not a status string.
    expect(paneReachable('send', NOTHING)).toBe(false)
  })
})

describe('where the panel opens', () => {
  it('lands on the furthest pane with work in it', () => {
    expect(furthestReachablePane(NOTHING)).toBe('draft')
    expect(furthestReachablePane(DRAFTED)).toBe('send')
    expect(furthestReachablePane(SENT)).toBe('outcome')
  })

  it('never opens on a pane that is not reachable', () => {
    for (const available of [NOTHING, DRAFTED, SENT]) {
      expect(paneReachable(furthestReachablePane(available), available)).toBe(true)
    }
  })
})

describe('next and back', () => {
  it('walks forward while the work exists and stops when it does not', () => {
    expect(nextPane('note', NOTHING)).toBe('draft')
    expect(nextPane('draft', NOTHING)).toBeNull()
    expect(nextPane('draft', DRAFTED)).toBe('send')
    expect(nextPane('send', DRAFTED)).toBeNull()
    expect(nextPane('send', SENT)).toBe('outcome')
  })

  it('has nowhere to go after the last pane', () => {
    expect(nextPane('outcome', SENT)).toBeNull()
  })

  it('never refuses to go back', () => {
    // A Back button that declines is a trap: everything behind you is somewhere
    // you have already been.
    expect(prevPane('outcome')).toBe('send')
    expect(prevPane('send')).toBe('draft')
    expect(prevPane('draft')).toBe('note')
    expect(prevPane('note')).toBeNull()
  })

  it('back then next returns you to where you were', () => {
    for (const pane of WORK_PANES) {
      const behind = prevPane(pane)
      if (!behind) continue
      expect(nextPane(behind, SENT)).toBe(pane)
    }
  })
})

describe('clicking the bar', () => {
  it('goes backwards only', () => {
    expect(paneClickable('note', 'send')).toBe(true)
    expect(paneClickable('draft', 'send')).toBe(true)
    expect(paneClickable('outcome', 'send')).toBe(false)
  })

  it('does not offer the pane you are already standing on', () => {
    for (const pane of WORK_PANES) {
      expect(paneClickable(pane, pane)).toBe(false)
    }
  })

  it('can never reach an unreachable pane, whatever the row looks like', () => {
    // The point of backwards-only. Anything behind the current pane is either
    // note or draft (always open) or a pane whose work was done to get here.
    for (const current of WORK_PANES) {
      for (const target of WORK_PANES) {
        if (!paneClickable(target, current)) continue
        const available = current === 'outcome' ? SENT : current === 'send' ? DRAFTED : NOTHING
        expect(paneReachable(target, available), `${target} from ${current}`).toBe(true)
      }
    }
  })
})

describe('the map the bar draws', () => {
  it('puts every pane on a real stage, one each', () => {
    const stages = WORK_PANES.map(p => PANE_STAGE[p])
    expect(new Set(stages).size).toBe(WORK_PANES.length)
    for (const stage of stages) expect(STAGES).toContain(stage)
  })

  it('accounts for all six stages', () => {
    // A stage with neither a pane nor a place on the no-pane list would be a
    // dot in the bar that nothing explains.
    const withPane = WORK_PANES.map(p => PANE_STAGE[p])
    const accounted = new Set([...withPane, ...STAGES_WITHOUT_PANE])
    expect([...STAGES].every(s => accounted.has(s))).toBe(true)
    expect(accounted.size).toBe(STAGES.length)
  })

  it('keeps panes and stages in the same order', () => {
    // The bar draws stages left to right; Next walks panes. If those two
    // disagreed, Next would move the marker backwards along the bar.
    const positions = WORK_PANES.map(p => STAGES.indexOf(PANE_STAGE[p]))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('labels every pane', () => {
    for (const pane of WORK_PANES) expect(PANE_LABEL[pane]).toBeTruthy()
  })
})

describe('isWorkPane', () => {
  it('accepts the two old section names that are still panes', () => {
    // `lastStep` is a plain String column. Anyone who used the panel before it
    // stepped has 'note', 'draft' or 'send' stored.
    expect(isWorkPane('note')).toBe(true)
    expect(isWorkPane('draft')).toBe(true)
    expect(isWorkPane('send')).toBe(true)
  })

  it('rejects anything else, so a stale value cannot render a blank frame', () => {
    for (const bad of ['', 'letter', 'imported', 'awaiting', null, undefined, 3, {}]) {
      expect(isWorkPane(bad), String(bad)).toBe(false)
    }
  })
})
