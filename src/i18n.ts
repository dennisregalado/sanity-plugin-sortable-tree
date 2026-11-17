import {defineLocaleResourceBundle} from 'sanity'

/**
 * The locale namespace for this plugin's strings.
 *
 * @public
 */
export const sortableTreeLocaleNamespace = 'sortable-tree' as const

/**
 * English strings. Translate them by adding a bundle for another locale with the same namespace
 * (`defineLocaleResourceBundle({locale: 'nb-NO', namespace: 'sortable-tree', resources: {...}})`)
 * to your Studio's `i18n.bundles`.
 *
 * @internal
 */
export const sortableTreeUsEnglishLocaleBundle = defineLocaleResourceBundle({
  locale: 'en-US',
  namespace: sortableTreeLocaleNamespace,
  // Inline (not lazy-loaded) so the input never suspends while strings load
  resources: {
    /** Button that adds an item to the end of a list */
    'add-item': 'Add item',
    /** Tooltip and label for the row action that adds an item inside this one */
    'add-child': 'Add nested item',
    /** Tooltip and label for the button that collapses an item's children */
    'collapse': 'Collapse',
    /** Tooltip and label for the button that expands every item */
    'expand-all': 'Expand all',
    /** Tooltip and label for the button that collapses every item */
    'collapse-all': 'Collapse all',
    /** Tooltip and label for the drag handle */
    'drag-to-reorder': 'Drag to reorder',
    /** Tooltip and label for the button that opens an item */
    'edit': 'Edit',
    /** Tooltip and label for the button that expands an item's children */
    'expand': 'Expand',
    /** Shown when the list is empty */
    'no-items': 'No items',
    /** Tooltip and label for the button that removes an item */
    'remove': 'Remove',
    /** Number of items nested under an item, or being dragged together */
    'item-count_one': '{{count}} item',
    'item-count_other': '{{count}} items',
    /** Shown under an item whose nested items can't be shown (missing or repeated keys, wrong type) */
    'invalid-children': "Some nested items can't be shown here. Open this item to fix them.",
    /** Label for the icon on items with validation errors or warnings */
    'validation.errors_one': '{{count}} error',
    'validation.errors_other': '{{count}} errors',
    'validation.warnings_one': '{{count}} warning',
    'validation.warnings_other': '{{count}} warnings',
    /** Fallback title for items without one */
    'untitled': 'Untitled',
    /** Toast when the schema's initial value for a new item can't be resolved */
    'initial-value-error.title': 'Could not resolve initial value',
    /** Screen reader instructions for the drag handle */
    'announce.instructions':
      'To pick up an item, press space or enter. Use the up and down arrow keys to move it, and the left and right arrow keys to change how deeply it is nested. Press space or enter again to drop it, or escape to cancel.',
    /** Screen reader announcements while dragging */
    'announce.drag-start': 'Picked up {{title}}.',
    'announce.drag-over': '{{title}} is over {{target}}.',
    'announce.drag-end': 'Dropped {{title}}.',
    'announce.drag-cancel': 'Moving {{title}} was cancelled.',
  },
})
