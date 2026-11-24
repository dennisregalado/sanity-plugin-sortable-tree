import type {Item} from './types'
import {DEFAULT_CHILDREN_FIELD, walkTree} from './utils'

/**
 * Key of a list in the tree: its parent's tree id, or `ROOT_LIST` for the field's own array.
 * Every list (the root and each item's `children`) collapses on its own, like the Studio's arrays.
 */
export const ROOT_LIST = ''

export const listKey = (parentId: string | null): string => parentId ?? ROOT_LIST

/** The parent's tree id of an item's tree id (`null` at the root) */
export function getParentId(id: string): string | null {
  const index = id.lastIndexOf('/')
  return index === -1 ? null : id.slice(0, index)
}

/** The flattened items without the hidden ones and everything inside them */
export function withoutHidden<T extends {id: string}>(
  items: T[],
  hidden: ReadonlySet<string>,
): T[] {
  return hidden.size ? items.filter((item) => !hidden.has(item.id)) : items
}

/** The Studio's default for `form.arrays.collapseItems.limit` */
export const DEFAULT_COLLAPSE_LIMIT = 4

const isUsableLimit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

/** The workspace's `form.arrays.collapseItems`, as a limit (`Infinity` when it's turned off) */
export function getWorkspaceCollapseLimit(config: unknown): number {
  if (typeof config !== 'object' || config === null) return DEFAULT_COLLAPSE_LIMIT
  if ('enabled' in config && config.enabled === false) return Number.POSITIVE_INFINITY
  return 'limit' in config && isUsableLimit(config.limit) ? config.limit : DEFAULT_COLLAPSE_LIMIT
}

/**
 * How many items an array shows before "Show all N items", like the Studio's array input: the
 * array field's own `options.collapseItemsAfter` (a positive whole number, or `false` to never
 * collapse) wins over the workspace's setting.
 */
export function getCollapseLimit(arraySchemaType: unknown, workspaceLimit: number): number {
  const options =
    typeof arraySchemaType === 'object' && arraySchemaType !== null && 'options' in arraySchemaType
      ? arraySchemaType.options
      : undefined
  const limit =
    typeof options === 'object' && options !== null && 'collapseItemsAfter' in options
      ? options.collapseItemsAfter
      : undefined

  if (limit === false) return Number.POSITIVE_INFINITY
  return isUsableLimit(limit) ? limit : workspaceLimit
}

export interface CollapsedLists {
  /** Items past their list's limit (their own children are hidden with them) */
  hidden: ReadonlySet<string>
  /** Number of items in each list that has more than its limit, by list key */
  collapsible: ReadonlyMap<string, number>
}

/**
 * Which items are hidden behind their list's "Show all N items": in every list longer than its
 * limit that isn't expanded, the items after the limit. Lists are cut from the end, like the
 * Studio's arrays.
 */
export function getCollapsedLists(
  items: Item[],
  getLimit: (parentId: string | null) => number,
  expanded: ReadonlySet<string>,
  childrenField = DEFAULT_CHILDREN_FIELD,
): CollapsedLists {
  const counts = new Map<string, number>()
  const limits = new Map<string, number>()

  walkTree(
    items,
    (_item, _id, parentId) => {
      const key = listKey(parentId)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (!limits.has(key)) limits.set(key, getLimit(parentId))
    },
    childrenField,
  )

  const collapsible = new Map<string, number>()
  for (const [key, count] of counts) {
    if (count > (limits.get(key) ?? Number.POSITIVE_INFINITY)) collapsible.set(key, count)
  }

  const hidden = new Set<string>()
  const positions = new Map<string, number>()
  walkTree(
    items,
    (_item, id, parentId) => {
      const key = listKey(parentId)
      const position = positions.get(key) ?? 0
      positions.set(key, position + 1)

      if (parentId !== null && hidden.has(parentId)) {
        hidden.add(id)
      } else if (
        collapsible.has(key) &&
        !expanded.has(key) &&
        position >= (limits.get(key) ?? Number.POSITIVE_INFINITY)
      ) {
        hidden.add(id)
      }
    },
    childrenField,
  )

  return {hidden, collapsible}
}
