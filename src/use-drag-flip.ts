import {type RefObject, useCallback, useMemo, useRef} from 'react'

import {getScrollParent} from './use-row-windowing'

// The Studio's array items slide into place with their sort transition
// (sanity/src/core/form/inputs/arrays/common/list.tsx, `TRANSITION`)
const SLIDE_TIMING: KeyframeAnimationOptions = {duration: 200, easing: 'ease'}

/**
 * The tree's rows, "Add item" buttons and notices: everything that moves on its own when the
 * projected position of the dragged row changes. Not the dragged row (dnd-kit moves it with the
 * pointer), the placeholder dnd-kit leaves in its place, or the containers of nested lists.
 */
function getMovingElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('li > *')].filter(
    (element) =>
      !element.matches('[data-dnd-dragging], [data-dnd-placeholder]') &&
      !element.querySelector('li'),
  )
}

/** How far an element is moved by the slide it's in the middle of */
function getSlideOffset(element: Element): {x: number; y: number} {
  const [x = '0', y = '0'] = getComputedStyle(element).translate.split(' ')

  return {x: parseFloat(x) || 0, y: parseFloat(y) || 0}
}

/** The part of the window the tree's rows can be seen in: its scroll parent, within the window */
function getVisibleBounds(scrollParent: HTMLElement | null): {top: number; bottom: number} {
  const rect = scrollParent?.getBoundingClientRect()

  return {
    top: Math.max(rect?.top ?? 0, 0),
    bottom: Math.min(rect?.bottom ?? Infinity, window.innerHeight),
  }
}

/**
 * While dragging, React moves rows around as the dragged row's projected position changes. This
 * makes them slide to their new places instead of jumping, also when the dragged row moves between
 * nested lists: `snapshot` records where everything is laid out before a projection is rendered,
 * and `play` (in a layout effect, once that projection is rendered) animates each element from
 * where it was on screen.
 */
export function useDragFlip(containerRef: RefObject<HTMLElement | null>) {
  // Where each element was laid out: without the slide it was in the middle of, which goes on
  const before = useRef<Map<Element, {left: number; top: number}> | null>(null)
  const animations = useRef(new WeakMap<Element, Animation>())
  const scrollParent = useRef<{container: HTMLElement; element: HTMLElement | null} | null>(null)

  const snapshot = useCallback(() => {
    const container = containerRef.current
    // The first snapshot before a render wins: the DOM hasn't changed since
    if (before.current || !container) return

    before.current = new Map(
      getMovingElements(container).map((element) => {
        const {left, top} = element.getBoundingClientRect()
        const offset = getSlideOffset(element)

        return [element, {left: left - offset.x, top: top - offset.y}]
      }),
    )
  }, [containerRef])

  const play = useCallback(() => {
    const container = containerRef.current
    const from = before.current
    before.current = null

    if (!container || !from) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (scrollParent.current?.container !== container) {
      scrollParent.current = {container, element: getScrollParent(container)}
    }
    const visible = getVisibleBounds(scrollParent.current.element)

    // Measure everything first, then start the animations: reading styles or layout after
    // cancelling or starting an animation would force the browser to recalculate them, once per
    // element
    const moves: Array<{element: HTMLElement; x: number; y: number; hidden: boolean}> = []
    for (const element of getMovingElements(container)) {
      const previous = from.get(element)
      if (!previous) continue

      // From where it is on screen now (with the slide it's in the middle of), to where it's now
      // laid out (without it)
      const offset = getSlideOffset(element)
      const rect = element.getBoundingClientRect()
      const next = {left: rect.left - offset.x, top: rect.top - offset.y}
      const x = previous.left + offset.x - next.left
      const y = previous.top + offset.y - next.top

      // A row that's out of sight where it slides from and where it slides to, on the same side,
      // stays out of sight all the way (the slide is a straight line): it can just jump. Most rows
      // that move in a long tree are like this, and each slide costs style and compositing work
      // every frame.
      const fromTop = next.top + y
      const above = fromTop + rect.height <= visible.top && next.top + rect.height <= visible.top
      const below = fromTop >= visible.bottom && next.top >= visible.bottom
      moves.push({element, x, y, hidden: above || below})
    }

    for (const {element, x, y, hidden} of moves) {
      animations.current.get(element)?.cancel()

      if (reducedMotion || hidden || (!x && !y)) continue

      animations.current.set(
        element,
        element.animate({translate: [`${x}px ${y}px`, '0 0']}, SLIDE_TIMING),
      )
    }
  }, [containerRef])

  return useMemo(() => ({snapshot, play}), [play, snapshot])
}
