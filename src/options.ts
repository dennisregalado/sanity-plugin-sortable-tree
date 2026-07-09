export interface SortableTreeArrayOptions {
  tree?: boolean
  maxDepth?: number
}

declare module 'sanity' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export interface ArrayOptions<V = unknown> extends SortableTreeArrayOptions {}
}
