import type {UniqueIdentifier} from '@dnd-kit/abstract'

import type {FlattenedItem, Item} from './types'

export function getTreeItemId(parentId: string | null, key: string): string {
  return parentId ? `${parentId}/${key}` : key
}

/** Whether `value` is an array item the tree can show: an object with a string `_key` */
export function isTreeItem(value: unknown): value is Item {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_key' in value &&
    typeof value._key === 'string' &&
    value._key.length > 0
  )
}

/** Whether `value` is a plain object */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const EMPTY_ITEM_KEYS = new Set(['_key', '_type', '_weak'])

/**
 * Whether an item has no content yet, like the Studio's new items (`_key` and `_type` only): only
 * those get the schema's initial value
 */
export function isEmptyItem(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((key) => EMPTY_ITEM_KEYS.has(key))
}

/** The valid children of an item. Malformed `children` (not an array) count as none. */
export function getChildItems(item: Item): Item[] {
  return Array.isArray(item.children) ? item.children : []
}

/**
 * Visits every item depth-first, with its tree id. Items the tree can't show (not an object,
 * no `_key`, or a `_key` already used by an earlier sibling) are skipped with their children:
 * the Studio reports those in the item's own dialog, and they're never written to by the tree.
 */
export function walkTree(
  items: unknown,
  visit: (
    item: Item,
    id: string,
    parentId: string | null,
    depth: number,
    index: number,
  ) => boolean | void,
  parentId: string | null = null,
  depth = 0,
): void {
  if (!Array.isArray(items)) return

  const seenKeys = new Set<string>()
  let index = 0

  for (const item of items) {
    if (!isTreeItem(item) || seenKeys.has(item._key)) continue
    seenKeys.add(item._key)

    const id = getTreeItemId(parentId, item._key)
    // Returning false skips the item's children
    if (visit(item, id, parentId, depth, index) !== false) {
      walkTree(item.children, visit, id, depth + 1)
    }
    index += 1
  }
}

/**
 * Flattens the tree into display order. With `collapsedKeys`, children of collapsed items are
 * left out (`skipCollapsedChildren`, used while dragging) or kept (used for rendering, so
 * collapsed subtrees can animate).
 */
export function flattenTree(
  items: Item[],
  collapsedKeys: ReadonlySet<string> = new Set(),
  skipCollapsedChildren = true,
): FlattenedItem[] {
  const flattenedItems: FlattenedItem[] = []

  walkTree(items, (item, id, parentId, depth, index) => {
    const collapsed = collapsedKeys.has(id)

    flattenedItems.push({...item, id, collapsed, parentId, depth, index})

    return !(collapsed && skipCollapsedChildren)
  })

  return flattenedItems
}

export function getDragDepth(offset: number, indentationWidth: number) {
  return Math.round(offset / indentationWidth)
}

export function getProjection(
  items: FlattenedItem[],
  targetId: UniqueIdentifier,
  projectedDepth: number,
  maxDepth = Number.POSITIVE_INFINITY,
) {
  const targetItemIndex = items.findIndex(({id}) => id === String(targetId))
  const previousItem = items[targetItemIndex - 1]
  const targetItem = items[targetItemIndex]
  const nextItem = items[targetItemIndex + 1]
  const maxProjectedDepth = Math.min(
    getMaxDepth(targetItem, previousItem),
    Math.max(0, maxDepth - 1),
  )
  const minDepth = Math.min(getMinDepth(nextItem), maxProjectedDepth)
  let depth = projectedDepth

  if (projectedDepth >= maxProjectedDepth) {
    depth = maxProjectedDepth
  } else if (projectedDepth < minDepth) {
    depth = minDepth
  }

  return {depth, maxDepth: maxProjectedDepth, minDepth, parentId: getParentId()}

  function getParentId() {
    if (depth === 0 || !previousItem) {
      return null
    }

    if (depth === previousItem.depth) {
      return previousItem.parentId
    }

    if (depth > previousItem.depth) {
      return previousItem.id
    }

    const newParent = items
      .slice(0, targetItemIndex)
      .reverse()
      .find((item) => item.depth === depth)?.parentId

    return newParent ?? null
  }
}

function getMaxDepth(targetItem: FlattenedItem, previousItem: FlattenedItem | undefined) {
  if (!previousItem) return 0

  return Math.min(targetItem.depth + 1, previousItem.depth + 1)
}

function getMinDepth(nextItem: FlattenedItem) {
  return nextItem ? nextItem.depth : 0
}

export function getDescendants(
  items: FlattenedItem[],
  parentId: UniqueIdentifier,
): Set<UniqueIdentifier> {
  const childrenByParent = new Map<string | null, FlattenedItem[]>()

  for (const item of items) {
    const siblings = childrenByParent.get(item.parentId)

    if (siblings) {
      siblings.push(item)
    } else {
      childrenByParent.set(item.parentId, [item])
    }
  }

  const descendants = new Set<UniqueIdentifier>()

  const visitChildren = (currentParentId: UniqueIdentifier) => {
    const directChildren = childrenByParent.get(String(currentParentId))

    if (!directChildren) return

    for (const child of directChildren) {
      descendants.add(child.id)
      visitChildren(child.id)
    }
  }

  visitChildren(parentId)

  return descendants
}
