/**
 * An item in the tree: an array member with a `_key`, its own fields, and optionally nested
 * `children`.
 *
 * @public
 */
export interface Item {
  _key: string
  _type?: string
  children?: Item[]
  /** When true in the stored value, the item starts out collapsed */
  collapsed?: boolean
  [field: string]: unknown
}

/**
 * An item placed in the flattened tree, with its position.
 *
 * @public
 */
export interface FlattenedItem extends Item {
  /** Path-based id: the keys of the item and its ancestors, joined with `/` */
  id: string
  parentId: string | null
  depth: number
  index: number
  collapsed: boolean
}
