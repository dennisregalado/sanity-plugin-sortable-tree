import {UniqueIdentifier} from '@dnd-kit/abstract'
import {randomKey} from '@sanity/util/content'

import type {Item, FlattenedItem} from './types'

export function getTreeItemId(parentId: string | null, key: string, _index: number) {
  const segment = key

  return parentId ? `${parentId}/${segment}` : segment
}

export function ensureUniqueSiblingKeys(items: Item[]): {items: Item[]; changed: boolean} {
  let changed = false
  const seenKeys = new Set<string>()

  const nextItems = items.map((item) => {
    let key = item._key

    if (!key || seenKeys.has(key)) {
      changed = true

      do {
        key = randomKey(12)
      } while (seenKeys.has(key))
    }

    seenKeys.add(key)

    const hasChildren = Array.isArray(item.children)
    const nextChildren = hasChildren ? ensureUniqueSiblingKeys(item.children ?? []) : undefined

    if (key !== item._key || nextChildren?.changed) {
      changed = true

      return {
        ...item,
        _key: key,
        ...(nextChildren ? {children: nextChildren.items} : {}),
      }
    }

    return item
  })

  return {items: nextItems, changed}
}

export function flattenTree(
  items: Item[],
  collapsedKeys: ReadonlySet<string> = new Set(),
  parentId: string | null = null,
  depth = 0,
): FlattenedItem[] {
  const flattenedItems: FlattenedItem[] = []

  const walk = (
    treeItems: Item[] | undefined,
    currentParentId: string | null,
    currentDepth: number,
  ) => {
    if (!treeItems) return

    treeItems.forEach((item, index) => {
      const id = getTreeItemId(currentParentId, item._key, index)
      const collapsed = collapsedKeys.has(id)

      flattenedItems.push({
        ...item,
        id,
        collapsed,
        parentId: currentParentId,
        depth: currentDepth,
        index,
      })

      if (!collapsed) {
        walk(item.children, id, currentDepth + 1)
      }
    })
  }

  walk(items, parentId, depth)

  return flattenedItems
}

/**
 * Maps every tree id (see `getTreeItemId`) to the original item value at that position.
 */
export function indexItemsById(
  items: Item[],
  parentId: string | null = null,
  index: Map<string, Item> = new Map(),
): Map<string, Item> {
  items.forEach((item, position) => {
    const id = getTreeItemId(parentId, item._key, position)

    index.set(id, item)

    if (Array.isArray(item.children)) {
      indexItemsById(item.children, id, index)
    }
  })

  return index
}

/**
 * Removes the tree bookkeeping that `flattenTree` adds. Only used when the original value is
 * unknown: these names can also be real schema fields, so prefer the original value.
 */
function omitTreeMeta(item: FlattenedItem): Item {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {id, parentId, depth, index, collapsed, ...value} = item

  return value
}

/**
 * Rebuilds a nested value from flattened items.
 *
 * Each node is rebuilt from its original value in `originals` (keyed by tree id), so fields that
 * share a name with the tree bookkeeping (`id`, `parentId`, `depth`, `index`, `collapsed`) are
 * preserved instead of being overwritten or dropped.
 */
export function buildTree(
  flattenedItems: FlattenedItem[],
  originals?: ReadonlyMap<string, Item>,
): Item[] {
  const rootChildren: Item[] = []
  const nodes = new Map<string, Item>()
  const entries = flattenedItems.map((item) => {
    const original = originals?.get(item.id) ?? omitTreeMeta(item)
    const node: Item = {
      ...original,
      // Collapsed items keep their children: those aren't part of the flattened list.
      children: item.collapsed ? original.children || [] : [],
    }

    return {item, node}
  })

  for (const {item, node} of entries) {
    nodes.set(item.id, node)
  }

  for (const {item, node} of entries) {
    if (item.parentId === null) {
      rootChildren.push(node)
      continue
    }

    const parent = nodes.get(item.parentId)

    if (parent) {
      parent.children = [...(parent.children ?? []), node]
    }
  }

  return rootChildren
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
