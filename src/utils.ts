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

export function buildTree(flattenedItems: FlattenedItem[]): Item[] {
  const rootChildren: Item[] = []
  const nodes = new Map<string, Item>()
  const items = flattenedItems.map((item) => ({
    ...item,
    children: item.collapsed ? item.children || [] : [],
  }))

  for (const item of items) {
    nodes.set(item.id, item)
  }

  for (const item of items) {
    if (item.parentId === null) {
      rootChildren.push(item)
      continue
    }

    const parent = nodes.get(item.parentId)

    if (parent) {
      parent.children = [...(parent.children ?? []), item]
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
