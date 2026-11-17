import {type RefObject, useLayoutEffect, useRef, useState} from 'react'

/** Rows are mounted this far outside the viewport, so they're ready before they scroll into view */
const ROOT_MARGIN = '800px 0px'

/** Rows rendered before the first visibility check */
const INITIAL_ROWS = 60

/** The nearest ancestor that scrolls vertically (null: the viewport) */
function getScrollParent(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null
  while (current) {
    const {overflowY} = getComputedStyle(current)
    if (overflowY === 'auto' || overflowY === 'scroll') return current
    current = current.parentElement
  }
  return null
}

export interface RowWindowing {
  /** Whether the row (and its subtree) should render; off-screen rows render a placeholder */
  isVisible: (id: string) => boolean
  /** Last measured height of an off-screen row (and its subtree) */
  heightOf: (id: string) => number | undefined
}

const ALWAYS: RowWindowing = {isVisible: () => true, heightOf: () => undefined}

/**
 * Windowing for long trees that keeps the nested list structure: rows (with their subtrees) that
 * are far outside the viewport render an empty placeholder of the same height, so they don't cost
 * React renders, layout or drag-and-drop measurements. Rows are `li[data-tree-id]` elements in
 * `containerRef`; one IntersectionObserver tracks them.
 *
 * Disabled (everything renders) unless `enabled`.
 */
export function useRowWindowing(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  initialIds: string[],
): RowWindowing {
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set(initialIds.slice(0, INITIAL_ROWS)),
  )
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const observedRef = useRef(new Set<Element>())

  // A layout effect, so the observer exists before the effect below registers the first rows
  useLayoutEffect(() => {
    if (!enabled) return undefined

    const observed = observedRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        const shown: string[] = []
        const hidden: Array<[string, number]> = []
        for (const entry of entries) {
          const id = entry.target instanceof HTMLElement ? entry.target.dataset.treeId : undefined
          if (!id) continue
          if (entry.isIntersecting) shown.push(id)
          else hidden.push([id, entry.boundingClientRect.height])
        }

        setVisibleIds((previous) => {
          const changed =
            shown.some((id) => !previous.has(id)) || hidden.some(([id]) => previous.has(id))
          if (!changed) return previous

          const next = new Set(previous)
          for (const id of shown) next.add(id)
          for (const [id] of hidden) next.delete(id)
          return next
        })

        const measured = hidden.filter(([, height]) => height > 0)
        if (measured.length) {
          setHeights((previous) => {
            if (measured.every(([id, height]) => previous.get(id) === height)) return previous
            const next = new Map(previous)
            for (const [id, height] of measured) next.set(id, height)
            return next
          })
        }
      },
      // The pane scrolls, not the window: observe against it so the margin pre-mounts rows
      {root: getScrollParent(containerRef.current), rootMargin: ROOT_MARGIN},
    )

    observerRef.current = observer
    return () => {
      observer.disconnect()
      observerRef.current = null
      observed.clear()
    }
  }, [containerRef, enabled])

  // After every commit: observe new rows, forget removed ones
  useLayoutEffect(() => {
    const observer = observerRef.current
    const container = containerRef.current
    if (!observer || !container) return

    const observed = observedRef.current
    const current = new Set<Element>(container.querySelectorAll('li[data-tree-id]'))
    for (const element of observed) {
      if (!current.has(element)) {
        observer.unobserve(element)
        observed.delete(element)
      }
    }
    for (const element of current) {
      if (!observed.has(element)) {
        observer.observe(element)
        observed.add(element)
      }
    }
  })

  if (!enabled) return ALWAYS

  return {
    isVisible: (id) => visibleIds.has(id),
    heightOf: (id) => heights.get(id),
  }
}
