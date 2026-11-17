import {definePlugin} from 'sanity'

import {FormInput} from './form-input'
import {sortableTreeLocaleNamespace, sortableTreeUsEnglishLocaleBundle} from './i18n'
import {SortableTreeInput} from './input'
import type {SortableTreeArrayOptions} from './options'

export {SortableTreeInput}
export type {Item, FlattenedItem} from './types'
export type {SortableTreeArrayOptions}
export {sortableTreeLocaleNamespace}

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
    i18n: {bundles: [sortableTreeUsEnglishLocaleBundle]},
    form: {
      components: {
        input: FormInput,
      },
    },
  }
})
