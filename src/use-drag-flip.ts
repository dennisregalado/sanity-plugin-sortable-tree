import {type RefObject, useCallback, useMemo, useRef} from 'react'

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

    for (const element of getMovingElements(container)) {
      const previous = from.get(element)
      if (!previous) continue

      // From where it is on screen now, to where it's now laid out
      const offset = getSlideOffset(element)
      animations.current.get(element)?.cancel()
      const next = element.getBoundingClientRect()
      const x = previous.left + offset.x - next.left
      const y = previous.top + offset.y - next.top

      if (reducedMotion || (!x && !y)) continue

      animations.current.set(
        element,
        element.animate({translate: [`${x}px ${y}px`, '0 0']}, SLIDE_TIMING),
      )
    }
  }, [containerRef])

  return useMemo(() => ({snapshot, play}), [play, snapshot])
}
