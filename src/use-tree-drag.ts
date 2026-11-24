import {configure, type UniqueIdentifier} from '@dnd-kit/abstract'
import {Accessibility, defaultPreset, Feedback} from '@dnd-kit/dom'
import {isKeyboardEvent} from '@dnd-kit/dom/utilities'
import type {DragDropProvider} from '@dnd-kit/react'
import {type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {FormPatch, Path} from 'sanity'

import {keepDraggedRowLifted, restrictToList, snapToDepth} from './drag-feedback'
import {getMovePatches} from './patches'
import type {FlattenedItem, Item} from './types'
import {useDragFlip} from './use-drag-flip'
import {getDescendants, getDragDepth, getProjection} from './utils'

type ProviderProps = React.ComponentProps<typeof DragDropProvider>

// The dragged row settles into place (and follows keyboard moves) like the Studio's array items,
// which use their sort transition for this (sanity/src/core/form/inputs/arrays/common/list.tsx)
const SETTLE_TRANSITION = {duration: 200, easing: 'ease'}

/** The hidden copy dnd-kit leaves in the dragged row's place, where it will be dropped */
function getDropPlaceholder(element: Element | undefined): Element | null {
  return element?.ownerDocument.querySelector('[data-dnd-placeholder]') ?? null
}

/** The visible title of a draggable row, for screen reader announcements */
function getRowTitle(element: Element | undefined): string {
  return element?.textContent?.trim() || ''
}

/** The dragged item and the visible items inside it, which move with it */
interface DragSource {
  item: FlattenedItem
  children: FlattenedItem[]
}

type Translate = (key: string, values?: Record<string, unknown>) => string

interface Options {
  /** The tree's root element: drag feedback animates its rows */
  containerRef: RefObject<HTMLElement | null>
  /** The tree's value */
  items: Item[]
  /** The draggable items in display order, without the children of collapsed items */
  dragItems: FlattenedItem[]
  childrenField: string
  indentation: number
  maxDepth: number
  /** Whether items can be dropped into this one (it has a nested list) */
  canHaveChildren: (item: FlattenedItem) => boolean
  /** Whether the list of the item `parentId` (`null`: the root) accepts the item's type */
  canMoveItemToParent: (item: FlattenedItem, parentId: string | null) => boolean
  /** The path of an item (relative to the root array) */
  getPath: (id: string) => Path | undefined
  onPatch: (patches: FormPatch[]) => void
  /** An item was dropped into the item `parentId`: show its children */
  onDropInto: (parentId: string) => void
  t: Translate
}

export interface TreeDrag {
  /** Where the items are while dragging (in display order), or `null` when not dragging */
  projectedItems: FlattenedItem[] | null
  dragSource: DragSource | null
  /** Drops the projection, e.g. when the tree changes under it */
  cancelProjection: () => void
  /** Props for the `DragDropProvider` */
  providerProps: Omit<ProviderProps, 'children'>
}

/**
 * Dragging rows to reorder and nest them, with the pointer or the keyboard. While dragging, the
 * tree renders the projected items: where every row would be if the dragged one were dropped
 * now. React owns that order (dnd-kit's sortable plugins are off, see TreeItem), and the rows
 * slide to their new places (useDragFlip). Dropping sends the move as patches.
 */
export function useTreeDrag({
  containerRef,
  items,
  dragItems,
  childrenField,
  indentation,
  maxDepth,
  canHaveChildren,
  canMoveItemToParent,
  getPath,
  onPatch,
  onDropInto,
  t,
}: Options): TreeDrag {
  const [projectedItems, setProjectedItems] = useState<FlattenedItem[] | null>(null)
  // The dragged item and its children, for rendering (the refs below are for event handlers)
  const [dragSource, setDragSource] = useState<DragSource | null>(null)
  const projectedItemsRef = useRef<FlattenedItem[] | null>(null)
  const initialDepth = useRef(0)
  const sourceItem = useRef<FlattenedItem | null>(null)
  const sourceChildren = useRef<FlattenedItem[]>([])
  // How many levels the dragged item's children reach below it: they count towards `maxDepth`
  const sourceDescendantDepth = useRef(0)
  // Set by keyboard moves: moves the dragged row to its new position after it renders
  const followSourceRef = useRef<(() => void) | null>(null)
  // Rows slide out of the way of the dragged row
  const dragFlip = useDragFlip(containerRef)

  // After every render while dragging: slide the rows that moved. dnd-kit calls the drag handlers
  // in a transition, so the form's own update (from a drop's patches) can render before the
  // projection does: then note where the rows are again, for the projection's render.
  useLayoutEffect(() => {
    keepDraggedRowLifted(containerRef.current)
    dragFlip.play()
    if (projectedItemsRef.current !== projectedItems) dragFlip.snapshot()
  })

  useLayoutEffect(() => {
    const follow = followSourceRef.current
    followSourceRef.current = null
    follow?.()
  }, [projectedItems])

  const updateProjectedItems = useCallback(
    (nextItems: FlattenedItem[] | null) => {
      // While dragging: note where the rows are, to slide them from there once React moves them
      if (nextItems || projectedItemsRef.current) dragFlip.snapshot()
      projectedItemsRef.current = nextItems
      setProjectedItems(nextItems)
    },
    [dragFlip],
  )

  const cancelProjection = useCallback(() => updateProjectedItems(null), [updateProjectedItems])

  const endDrag = useCallback(() => {
    sourceItem.current = null
    sourceChildren.current = []
    sourceDescendantDepth.current = 0
    setDragSource(null)
    updateProjectedItems(null)
  }, [updateProjectedItems])

  // dnd-kit's default plugins, with announcements that use item titles and the Studio's locale
  const plugins = useMemo(
    () => [
      ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility && plugin !== Feedback),
      // No drag overlay: the dragged row itself is lifted and moves with the pointer
      configure(Feedback, {
        dropAnimation: SETTLE_TRANSITION,
        keyboardTransition: SETTLE_TRANSITION,
      }),
      configure(Accessibility, {
        screenReaderInstructions: {draggable: t('announce.instructions')},
        announcements: {
          dragstart: ({operation: {source}}) =>
            source ? t('announce.drag-start', {title: getRowTitle(source.element)}) : undefined,
          dragover: ({operation: {source, target}}) =>
            source && target
              ? t('announce.drag-over', {
                  title: getRowTitle(source.element),
                  target: getRowTitle(target.element),
                })
              : undefined,
          dragend: ({operation: {source}, canceled}) =>
            source
              ? t(canceled ? 'announce.drag-cancel' : 'announce.drag-end', {
                  title: getRowTitle(source.element),
                })
              : undefined,
        },
      }),
    ],
    [t],
  )

  // The dragged row moves vertically with the pointer, at the indentation of its projected depth
  const getDragOffsetX = useCallback(() => {
    const source = sourceItem.current
    const projected = source && projectedItemsRef.current?.find(({id}) => id === source.id)

    return projected ? (projected.depth - initialDepth.current) * indentation : null
  }, [indentation])
  const getTreeElement = useCallback(() => containerRef.current, [containerRef])
  const modifiers = useMemo(
    // oxlint-disable-next-line react/refs -- dnd-kit calls these during drags, not while rendering
    () => [snapToDepth(getDragOffsetX), restrictToList(getTreeElement)],
    [getDragOffsetX, getTreeElement],
  )

  const project = (activeItems: FlattenedItem[], targetId: UniqueIdentifier, depth: number) =>
    getProjection(
      activeItems,
      targetId,
      depth,
      maxDepth - sourceDescendantDepth.current,
      canHaveChildren,
    )

  /** The projected items with the dragged item's children back in place under it */
  const restoreSourceChildren = (activeItems: FlattenedItem[]): FlattenedItem[] => {
    const source = sourceItem.current
    if (!source || !sourceChildren.current.length) return activeItems

    const movedSource = activeItems.find((item) => item.id === source.id)
    if (!movedSource) return activeItems

    const sourceChildIds = new Set(sourceChildren.current.map((item) => item.id))
    const depthOffset = movedSource.depth - source.depth
    const baseItems = activeItems.filter((item) => !sourceChildIds.has(item.id))
    const nextSourceIndex = baseItems.indexOf(movedSource)
    const restoredChildren = sourceChildren.current.map((item) => ({
      ...item,
      depth: item.depth + depthOffset,
      parentId: item.parentId === source.id ? movedSource.id : item.parentId,
    }))

    return [
      ...baseItems.slice(0, nextSourceIndex + 1),
      ...restoredChildren,
      ...baseItems.slice(nextSourceIndex + 1),
    ]
  }

  const onDragStart: ProviderProps['onDragStart'] = (event) => {
    const {source} = event.operation
    if (!source) return

    const activeItems = projectedItemsRef.current ?? dragItems
    const draggedItem = activeItems.find(({id}) => id === String(source.id))
    if (!draggedItem) return

    // Visible descendants move with the item: take them out of the list while dragging
    const descendants = getDescendants(activeItems, source.id)
    const children = activeItems.filter((item) => descendants.has(item.id))

    initialDepth.current = draggedItem.depth
    sourceItem.current = draggedItem
    sourceChildren.current = children
    sourceDescendantDepth.current = Math.max(
      0,
      ...children.map((item) => item.depth - draggedItem.depth),
    )
    setDragSource({item: draggedItem, children})

    updateProjectedItems(activeItems.filter((item) => !descendants.has(item.id)))
  }

  const onDragOver: ProviderProps['onDragOver'] = (event, manager) => {
    const {source, target} = event.operation

    event.preventDefault()

    // Keyboard drags move by position in the tree (onDragMove), not by what they're over
    if (isKeyboardEvent(event.operation.activatorEvent)) return
    if (!source || !target || source.id === target.id) return

    const activeItems = projectedItemsRef.current ?? dragItems
    // The pointer's own offset: the dragged row's (`transform`) snaps to the projected depth
    const dragDepth = getDragDepth(manager.dragOperation.position.delta.x, indentation)
    const {depth, parentId} = project(activeItems, target.id, initialDepth.current + dragDepth)

    const sourceIndex = activeItems.findIndex((item) => item.id === String(source.id))
    const targetIndex = activeItems.findIndex((item) => item.id === String(target.id))
    if (sourceIndex === -1 || targetIndex === -1) return

    const nextItems = [...activeItems]
    const [movedItem] = nextItems.splice(sourceIndex, 1)
    if (!movedItem || !canMoveItemToParent(movedItem, parentId)) return

    nextItems.splice(targetIndex, 0, {...movedItem, depth, parentId})
    updateProjectedItems(nextItems)
  }

  const onDragMove: ProviderProps['onDragMove'] = (event, manager) => {
    if (event.defaultPrevented) return

    const {source, target} = event.operation
    if (!source) return

    const keyboard = isKeyboardEvent(event.operation.activatorEvent)
    const activeItems = projectedItemsRef.current ?? dragItems

    // Up/down arrow keys: move one position in the tree, keeping the depth where possible
    if (keyboard && event.by && event.by.y !== 0 && event.by.x === 0) {
      event.preventDefault()

      const index = activeItems.findIndex((item) => item.id === String(source.id))
      const nextIndex = index + Math.sign(event.by.y)
      const movedItem = activeItems[index]
      if (!movedItem || nextIndex < 0 || nextIndex >= activeItems.length) return

      const nextItems = activeItems.filter((item) => item !== movedItem)
      nextItems.splice(nextIndex, 0, movedItem)

      const {depth, parentId} = project(nextItems, movedItem.id, movedItem.depth)
      if (!canMoveItemToParent(movedItem, parentId)) return

      nextItems[nextIndex] = {...movedItem, depth, parentId}

      // Move the dragged row to where it will be dropped, once React has placed it there (the
      // row itself is lifted out of the list, so measure the placeholder left in its place)
      const before = getDropPlaceholder(source.element)?.getBoundingClientRect()
      followSourceRef.current = () => {
        const after = getDropPlaceholder(source.element)?.getBoundingClientRect()
        if (!before || !after) return

        manager.actions.move({
          // Horizontally, one indentation per level, as with the left/right arrow keys
          by: {x: indentation * (depth - movedItem.depth), y: after.top - before.top},
          propagate: false,
        })
      }
      updateProjectedItems(nextItems)
      return
    }

    if (!target) return

    const currentDepth = typeof source.data.depth === 'number' ? source.data.depth : 0
    let projectedDepth: number

    // Left/right arrow keys: one level shallower or deeper
    if (keyboard && event.by && event.by.x !== 0 && event.by.y === 0) {
      event.preventDefault()
      projectedDepth = currentDepth + Math.sign(event.by.x)
    } else {
      // The pointer's own offset: the dragged row's (`transform`) snaps to the projected depth
      projectedDepth =
        initialDepth.current + getDragDepth(manager.dragOperation.position.delta.x, indentation)
    }

    const {depth, parentId} = project(activeItems, source.id, projectedDepth)

    if (keyboard && currentDepth !== depth) {
      manager.actions.move({by: {x: indentation * (depth - currentDepth), y: 0}, propagate: false})
    }

    if (source.data.depth === depth && source.data.parentId === parentId) return

    const movedItem = activeItems.find((item) => item.id === String(source.id))
    if (!movedItem || !canMoveItemToParent(movedItem, parentId)) return

    const nextItems = [...activeItems]
    nextItems[nextItems.indexOf(movedItem)] = {...movedItem, depth, parentId}
    updateProjectedItems(nextItems)
  }

  const onDragEnd: ProviderProps['onDragEnd'] = (event) => {
    const source = sourceItem.current
    const activeItems = projectedItemsRef.current ?? dragItems
    const restoredItems = restoreSourceChildren(activeItems)

    if (
      event.canceled ||
      !source ||
      !restoredItems.every((item) => canMoveItemToParent(item, item.parentId))
    ) {
      endDrag()
      return
    }

    const movedItem = restoredItems.find((item) => item.id === source.id)
    const fromPath = movedItem && getPath(movedItem.id)
    const parentPath = movedItem?.parentId == null ? null : getPath(movedItem.parentId)

    if (movedItem && fromPath && parentPath !== undefined) {
      // Only the dragged item changes position: its children move with it
      const siblings = restoredItems.filter((item) => item.parentId === movedItem.parentId)
      const position = siblings.indexOf(movedItem)
      const patches = getMovePatches(
        items,
        fromPath,
        {
          parentPath,
          afterKey: siblings[position - 1]?._key,
          beforeKey: siblings[position + 1]?._key,
        },
        childrenField,
      )

      if (movedItem.parentId) onDropInto(movedItem.parentId)
      if (patches.length) onPatch(patches)
    }

    endDrag()
  }

  return {
    projectedItems,
    dragSource,
    cancelProjection,
    providerProps: {plugins, modifiers, onDragStart, onDragOver, onDragMove, onDragEnd},
  }
}
