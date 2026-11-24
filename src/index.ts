import {definePlugin} from 'sanity'

import {FormInput} from './form-input'
import {sortableTreeLocaleNamespace, sortableTreeUsEnglishLocaleBundle} from './i18n'
import {SortableTreeInput} from './input'
import type {SortableTreeArrayOptions} from './options'

export {SortableTreeInput}
export type {Item, FlattenedItem} from './types'
export type {SortableTreeArrayOptions}
export {sortableTreeLocaleNamespace}
export {validateTreeDepth} from './validate-tree-depth'
export type {TreeDepthValidationOptions} from './validate-tree-depth'

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
 * Optionally set `options.maxDepth` (default 3) and `options.childrenField` (default `children`).
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
