/**
 * Options for array fields, added to Sanity's `ArrayOptions`.
 *
 * @public
 */
export interface SortableTreeArrayOptions {
  /** Edit the array as a sortable tree. Items nest under their `children` field. */
  tree?: boolean
  /** How many levels deep items can be nested (default 3) */
  maxDepth?: number
}

declare module 'sanity' {
  export interface ArrayOptions<V = unknown> extends SortableTreeArrayOptions {}
}
