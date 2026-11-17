import {randomKey} from '@sanity/util/content'
import {type FormPatch, insert, type Path, setIfMissing, unset} from 'sanity'

import type {Item} from './types'
import {isTreeItem} from './utils'

/** The field holding nested items */
export const CHILDREN_FIELD = 'children'

/** Path of the array that holds the children of the item at `parentPath` (`[]` for the root) */
export function getChildrenPath(parentPath: Path | null): Path {
  return parentPath ? [...parentPath, CHILDREN_FIELD] : []
}

/** Returns the array at `path` (relative to the root array), or `[]` */
export function getArrayAt(value: Item[] | undefined, path: Path): Item[] {
  let current: unknown = value

  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'object' && segment && '_key' in segment) {
      current = current.find((item) => isTreeItem(item) && item._key === segment._key)
    } else if (typeof segment === 'string' && current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return []
    }
  }

  return Array.isArray(current) ? (current as Item[]) : []
}

/** Removes the item at `path`, with its children */
export function getRemovePatches(path: Path): FormPatch[] {
  return [unset(path)]
}

/** Appends `item` to the array at `childrenPath` */
export function getAppendPatches(item: Item, childrenPath: Path): FormPatch[] {
  return [
    // The root array gets its setIfMissing from the Studio's array field
    ...(childrenPath.length ? [setIfMissing([], childrenPath)] : []),
    insert([item], 'after', [...childrenPath, -1]),
  ]
}

export interface MoveTarget {
  /** Path of the new parent item, or `null` for the root */
  parentPath: Path | null
  /** Key of the sibling the item should follow (`undefined` if it becomes the first child) */
  afterKey?: string
  /** Key of the sibling the item should precede (used when there's no `afterKey`) */
  beforeKey?: string
}

/**
 * Patches that move the item at `fromPath` (with its children) to a new position. Mirrors the
 * Studio's own array move (`unset` + `insert` by key) so concurrent edits elsewhere in the array
 * are kept. Returns no patches when the item doesn't actually move.
 *
 * Keys only need to be unique among siblings, so the item gets a new `_key` if its new siblings
 * already use its key.
 */
export function getMovePatches(value: Item[], fromPath: Path, target: MoveTarget): FormPatch[] {
  const fromKeySegment = fromPath[fromPath.length - 1]
  if (!fromKeySegment || typeof fromKeySegment !== 'object' || !('_key' in fromKeySegment)) {
    return []
  }

  const fromParentChildrenPath = fromPath.slice(0, -1)
  const fromSiblings = getArrayAt(value, fromParentChildrenPath)
  const moving = fromSiblings.find((item) => isTreeItem(item) && item._key === fromKeySegment._key)
  if (!moving) return []

  const toChildrenPath = getChildrenPath(target.parentPath)
  const sameArray = isSamePath(fromParentChildrenPath, toChildrenPath)

  if (sameArray) {
    const index = fromSiblings.indexOf(moving)
    const previous = fromSiblings[index - 1]
    const next = fromSiblings[index + 1]
    const unchanged = target.afterKey
      ? previous?._key === target.afterKey
      : !previous && (!target.beforeKey || next?._key === target.beforeKey)

    if (unchanged) return []
  }

  const toSiblings = getArrayAt(value, toChildrenPath)
  const keyTaken =
    !sameArray && toSiblings.some((item) => isTreeItem(item) && item._key === moving._key)
  const item = keyTaken ? {...moving, _key: uniqueKey(toSiblings)} : moving

  let insertPatch: FormPatch
  if (target.afterKey) {
    insertPatch = insert([item], 'after', [...toChildrenPath, {_key: target.afterKey}])
  } else if (target.beforeKey) {
    insertPatch = insert([item], 'before', [...toChildrenPath, {_key: target.beforeKey}])
  } else {
    insertPatch = insert([item], 'after', [...toChildrenPath, -1])
  }

  return [
    unset(fromPath),
    ...(toChildrenPath.length ? [setIfMissing([], toChildrenPath)] : []),
    insertPatch,
  ]
}

function uniqueKey(siblings: Item[]): string {
  const taken = new Set(siblings.map((item) => (isTreeItem(item) ? item._key : undefined)))
  let key = randomKey(12)
  while (taken.has(key)) key = randomKey(12)
  return key
}

function isSamePath(a: Path, b: Path): boolean {
  return (
    a.length === b.length &&
    a.every((segment, index) => {
      const other = b[index]
      if (typeof segment === 'object' && segment && typeof other === 'object' && other) {
        return '_key' in segment && '_key' in other && segment._key === other._key
      }
      return segment === other
    })
  )
}
