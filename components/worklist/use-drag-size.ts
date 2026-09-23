'use client'

import { useCallback, useRef, useSyncExternalStore } from 'react'

/**
 * Dragging an edge to resize something.
 *
 * Two things in the worklist need this — the divider between the table and the
 * work panel, and the handle on each column header — and they need it the same
 * way: press, track the pointer, write a number, release.
 *
 * Built on setPointerCapture rather than window-level mousemove listeners. The
 * capture means the element keeps receiving events even when the pointer runs
 * off it, which is the whole failure mode of a hand-rolled resize: drag fast,
 * outrun the 5px handle, and the element stops following while the button is
 * still held. It also cleans itself up on pointercancel, which a listener pair
 * added on mousedown does not when the gesture is interrupted.
 */

export type DragHandlers = {
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export function useDragSize({
  onStart,
  onDrag,
  step = 16,
  axis = 'x',
}: {
  /**
   * Called once when the gesture begins, before any movement.
   *
   * The caller needs this to snapshot whatever it is resizing. `deltaPx` below
   * is measured from where the drag STARTED, so a caller that adds it to the
   * current size on every frame compounds its own movement and the thing runs
   * away from the pointer. Snapshot here, add there.
   */
  onStart?: () => void
  /** Called with the pointer's distance from where the drag started. */
  onDrag: (deltaPx: number, commit: boolean) => void
  /** How far one arrow-key press moves it. */
  step?: number
  axis?: 'x' | 'y'
}): DragHandlers {
  const origin = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Ignore anything but the primary button: a right-click on a handle should
      // open a context menu, not start a resize that never gets a pointerup.
      if (e.button !== 0) return
      e.preventDefault()
      const el = e.currentTarget as HTMLElement
      origin.current = axis === 'x' ? e.clientX : e.clientY
      onStart?.()
      el.setPointerCapture(e.pointerId)

      const move = (ev: PointerEvent) => {
        onDrag((axis === 'x' ? ev.clientX : ev.clientY) - origin.current, false)
      }
      const up = (ev: PointerEvent) => {
        onDrag((axis === 'x' ? ev.clientX : ev.clientY) - origin.current, true)
        el.releasePointerCapture(ev.pointerId)
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
      }

      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    },
    [onStart, onDrag, axis],
  )

  // A resize handle that only responds to a pointer is not operable at all for
  // anyone using a keyboard, and these handles sit between a biller and their
  // own table layout.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
      const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
      if (e.key !== back && e.key !== forward) return
      e.preventDefault()
      // Each press is its own one-step gesture, so it snapshots too.
      onStart?.()
      onDrag(e.key === back ? -step : step, true)
    },
    [onStart, onDrag, step, axis],
  )

  return { onPointerDown, onKeyDown }
}

/**
 * Whether the viewport is wide enough to put the work panel beside the table.
 *
 * 1280px is Tailwind's `xl`, and it is where the arithmetic starts working: the
 * sidebar takes 14rem and the agent rail 23rem, so below this a third column
 * leaves two halves that are each too narrow to read a letter in.
 *
 * useSyncExternalStore rather than an effect, so the first client render already
 * knows the answer. An effect-based version renders the mobile branch, then the
 * desktop one, which on this screen means opening a modal and immediately
 * replacing it with a panel.
 */
const WIDE = '(min-width: 1280px)'

function subscribeWide(onChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia(WIDE)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

const getWide = () => window.matchMedia(WIDE).matches
// The server cannot know the viewport. Assuming narrow means the first paint is
// the modal, which is the branch that is correct at any width.
const getServerWide = () => false

export function useIsWideScreen(): boolean {
  return useSyncExternalStore(subscribeWide, getWide, getServerWide)
}
