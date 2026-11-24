import type {CustomValidator, Path, ValidationError} from 'sanity'

import {DEFAULT_CHILDREN_FIELD, isRecord, isTreeItem} from './utils'

/** The tree's default `maxDepth` */
export const DEFAULT_MAX_DEPTH = 3

/**
 * Options for {@link validateTreeDepth}. By default they're read from the tree field's own
 * `options` (`maxDepth`, `childrenField`).
 *
 * @public
 */
export interface TreeDepthValidationOptions {
  /** How many levels deep items can be nested (default: the field's `options.maxDepth`, or 3) */
  maxDepth?: number
  /** The field holding nested items (default: the field's `options.childrenField`, or `children`) */
  childrenField?: string
  /** The error message, or a function that returns it */
  message?: string | ((maxDepth: number) => string)
}

function defaultMessage(maxDepth: number): string {
  return `Nested more than ${maxDepth} ${maxDepth === 1 ? 'level' : 'levels'} deep`
}

/**
 * A custom validation rule for tree fields: items nested deeper than `maxDepth` get an error, on
 * the item itself. The tree never nests items deeper than `maxDepth`, but data written through
 * the API (or before `maxDepth` was lowered) can be.
 *
 * ```ts
 * defineField({
 *   name: 'items',
 *   type: 'array',
 *   of: [{type: 'menuItem'}],
 *   options: {tree: true, maxDepth: 3},
 *   validation: (rule) => rule.custom(validateTreeDepth()),
 * })
 * ```
 *
 * @public
 */
export function validateTreeDepth(options: TreeDepthValidationOptions = {}): CustomValidator {
  return (value, context) => {
    const fieldOptions: unknown = context.type?.options
    const fromField = (name: string): unknown =>
      isRecord(fieldOptions) ? fieldOptions[name] : undefined
    const fieldMaxDepth = fromField('maxDepth')
    const fieldChildrenField = fromField('childrenField')

    const maxDepth =
      options.maxDepth ?? (typeof fieldMaxDepth === 'number' ? fieldMaxDepth : DEFAULT_MAX_DEPTH)
    const childrenField =
      options.childrenField ??
      (typeof fieldChildrenField === 'string' && fieldChildrenField
        ? fieldChildrenField
        : DEFAULT_CHILDREN_FIELD)
    const message =
      typeof options.message === 'function'
        ? options.message(maxDepth)
        : (options.message ?? defaultMessage(maxDepth))

    const errors: ValidationError[] = []
    const visit = (list: unknown, path: Path, depth: number) => {
      if (!Array.isArray(list)) return
      const seenKeys = new Set<string>()
      for (const item of list) {
        // Items without a key (or with a repeated one) get the Studio's own errors
        if (!isTreeItem(item) || seenKeys.has(item._key)) continue
        seenKeys.add(item._key)

        const itemPath: Path = [...path, {_key: item._key}]
        // Only the outermost item that's too deep: everything inside it moves with it
        if (depth >= maxDepth) errors.push({message, path: itemPath})
        else visit(item[childrenField], [...itemPath, childrenField], depth + 1)
      }
    }
    visit(value, [], 0)

    return errors.length ? errors : true
  }
}
