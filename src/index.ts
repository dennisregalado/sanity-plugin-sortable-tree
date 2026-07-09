import React from 'react'
import {definePlugin, type ArrayOfObjectsInputProps, type InputProps} from 'sanity'

import {SortableTreeInput} from './input'
import type {SortableTreeArrayOptions} from './options'

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
          if (props.schemaType?.name === 'array' && props.schemaType?.options?.tree) {
            return React.createElement(SortableTreeInput, {
              ...(props as ArrayOfObjectsInputProps),
            })
          }

          return props.renderDefault(props)
        },
      },
    },
  }
})
