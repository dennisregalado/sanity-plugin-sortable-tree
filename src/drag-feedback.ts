import {configure, Modifier} from '@dnd-kit/abstract'

interface SnapToDepthOptions {
  /**
   * The horizontal offset of the dragged row's projected depth from its depth when the drag
   * started, or null to follow the pointer
   */
  getOffsetX: () => number | null
}

type Operation = Parameters<Modifier['apply']>[0]
type Coordinates = ReturnType<Modifier['apply']>

/**
 * The dragged row follows the pointer vertically, like the Studio's array items (which are
 * restricted to the vertical axis), and sits at the indentation of the depth it will be dropped
 * at, instead of following the pointer sideways.
 */
class SnapToDepth extends Modifier<any, SnapToDepthOptions> {
  apply({transform}: Operation): Coordinates {
    const x = this.options?.getOffsetX()

    return {x: x ?? transform.x, y: transform.y}
  }
}

export function snapToDepth(getOffsetX: SnapToDepthOptions['getOffsetX']) {
  return configure(SnapToDepth, {getOffsetX})
}

interface RestrictToListOptions {
  getElement: () => Element | null
}

/**
 * The dragged row stays within the tree vertically, like the Studio's array items
 * (sanity/src/core/form/inputs/arrays/common/list.tsx, `restrictToParentElementWithMargins`)
 *
 * The tree's bounds are measured when a drag starts and kept up to date as the tree resizes or
 * scrolls (like dnd-kit's `RestrictToElement`), instead of on every pointer move: reading them while
 * dnd-kit computes the dropped row's final position would force the browser to lay out the
 * just-changed tree.
 */
class RestrictToList extends Modifier<any, RestrictToListOptions> {
  private bounds: {top: number; bottom: number} | null = null

  constructor(manager: Modifier['manager'], options?: RestrictToListOptions) {
    super(manager, options)

    this.registerEffect(() => {
      const element = this.manager.dragOperation.status.initialized
        ? this.options?.getElement()
        : undefined
      if (!element) return undefined

      const measure = () => {
        const {top, bottom} = element.getBoundingClientRect()
        this.bounds = {top, bottom}
      }
      measure()

      const resizeObserver = new ResizeObserver(measure)
      resizeObserver.observe(element)
      document.addEventListener('scroll', measure, {capture: true, passive: true})

      return () => {
        resizeObserver.disconnect()
        document.removeEventListener('scroll', measure, {capture: true})
        this.bounds = null
      }
    })
  }

  apply({shape, transform}: Operation): Coordinates {
    const list = this.bounds
    const row = shape?.initial.boundingRectangle

    if (!list || !row) return transform

    const y = Math.min(Math.max(transform.y, list.top - row.top), list.bottom - row.bottom)

    return {x: transform.x, y}
  }
}

export function restrictToList(getElement: RestrictToListOptions['getElement']) {
  return configure(RestrictToList, {getElement})
}

/**
 * dnd-kit lifts the dragged row into the top layer as a popover. When React moves the row's list
 * item past the rows below it, the browser closes that popover (removing an element from the
 * document hides it, without the event dnd-kit listens for): show it again.
 */
export function keepDraggedRowLifted(container: HTMLElement | null) {
  const row = container?.querySelector<HTMLElement>('[data-dnd-dragging][popover]')

  try {
    if (row && !row.matches(':popover-open')) row.showPopover()
  } catch {
    // Browsers without popovers keep the dragged row in place with fixed positioning
  }
}
