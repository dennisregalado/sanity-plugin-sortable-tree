import {createElement} from 'react'
import {
  type ArrayOfObjectsInputProps,
  definePlugin,
  type InputProps,
  isArrayOfObjectsSchemaType,
} from 'sanity'

import {SortableTreeInput} from './input'
import type {SortableTreeArrayOptions} from './options'
import {TreeErrorBoundary} from './tree-error-boundary'

export {SortableTreeInput}
export type {Item, FlattenedItem} from './types'
export type {SortableTreeArrayOptions}

// Ensure ArrayOptions augmentation is loaded with the plugin
export type {} from './options'

/**
 * Usage in `sanity.config.ts` (or .js)
 *
 * ```ts
 * import {defineConfig} from 'sanity'
 * import {sortableTree} from 'sanity-plugin-sortable-tree'
 *
 * export default defineConfig({
 *   // ...
 *   plugins: [sortableTree()],
 * })
 * ```
 *
 * Enable on an array field with `options: { tree: true }`.
 * Optionally set `options.maxDepth` (default 3).
 *
 * @public
 */
export const sortableTree = definePlugin(() => {
  return {
    name: 'sanity-plugin-sortable-tree',
    form: {
      components: {
        input: (props: InputProps) => {
          // Any array of objects with `options.tree`, including named array types
          if (isArrayOfObjectsSchemaType(props.schemaType) && props.schemaType.options?.tree) {
            const arrayProps = props as ArrayOfObjectsInputProps

            // If the tree ever throws, fall back to the Studio's default array input
            return createElement(
              TreeErrorBoundary,
              {fallback: () => props.renderDefault(props)},
              createElement(SortableTreeInput, arrayProps),
            )
          }

          return props.renderDefault(props)
        },
      },
    },
  }
})
