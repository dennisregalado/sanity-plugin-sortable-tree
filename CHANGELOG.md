# sanity-plugin-sortable-tree

## 2.2.0

### Minor Changes

- References get their own search in the row instead of the Studio's reference input: focusing it opens a popover listing the documents the reference can point to, narrowed down as you type. It's the Studio's own search (every type in `to`, search configuration and strategy, perspective, `options.filter`), weak reference types stay weak, and documents that only exist as drafts are referenced weakly until published.
- A picked reference sits in the row like any other item, with the document's preview and status. Clicking it opens the document in a pane to the right, and the row stays selected while it's open; its pencil searches for a replacement. Searching and picked rows are the same size, so nothing shifts.
- The **Add item** type menu is now as wide as its items and centered under the button.

## 2.1.1

### Patch Changes

- 8b88831: Smoother dragging in long trees: rows that stay off-screen jump to their new place instead of sliding, rows whose only change is their position no longer re-render, and the drop no longer forces an extra layout

## 2.1.0

### Minor Changes

- 2ea927b: Production pass: safer edits, Sanity-native behavior, translations.

  **Fixes**

  - Reordering or removing an item no longer deletes fields named `id`, `index`, `depth`,
    `parentId` or `collapsed` from every item in the tree.
  - Edits are sent as targeted patches (`unset` + `insert` by `_key`, like the Studio's own array
    input) instead of replacing the whole array, so concurrent edits by other people are kept.
  - "Add item" is disabled for read-only fields and documents (published perspective, releases that
    aren't selected, missing permissions), and the tree never writes to a document on open.
  - New items get the schema's `initialValue`.
  - Named array types with `options.tree` now get the tree, and arrays of primitives keep the
    default input.
  - Malformed nested data (non-array `children`, items without `_key`) no longer crashes the form,
    and the field falls back to the default array input if the tree ever throws.
  - Nested items open reliably in the Studio's dialogs.

  **Improvements**

  - "Add item" opens a type menu for lists with several item types (it was disabled).
  - Edit and Remove also show on keyboard focus, and always on touch screens.
  - `options.sortable: false` and `disableActions: ['add' | 'remove']` are respected.
  - Items whose nested data can't be shown get a note instead of silently hiding it.
  - Validation errors and warnings show on rows, styled like the Studio's array items; collapsed
    items show their hidden children's errors.
  - "Add nested item" action on items without children.
  - Expand all / Collapse all, and collapsed items expand when the Studio focuses inside them.
  - Keyboard dragging moves one position per arrow key (dnd-kit 0.5).
  - Strings are translatable through the `sortable-tree` locale namespace (exported as
    `sortableTreeLocaleNamespace`), with an English bundle.
  - Accessible labels for icon buttons, and localized screen reader announcements while dragging.
  - Fewer re-renders: hovering and editing no longer re-render the whole tree.
  - Dragging looks like the Studio's own array input: the row itself lifts and the other rows slide
    aside (no more ghost overlay or tinted placeholder).
  - Long trees stay smooth: above 150 rows, only the rows near the viewport are rendered (500-item
    drag at about 60 fps, initial render roughly halved).
  - Item previews go through the Studio's preview pipeline (`PreviewProps.renderDefault`).
  - dnd-kit 0.5.

  **Types**

  - `SortableTreeInput` takes `ArrayOfObjectsInputProps` (it was needlessly generic).
  - `Item` allows any field (`[field: string]: unknown`), matching real array items.
  - The `react` peer range is `^19.2`, which Sanity Studio v6 already requires.

- 4c6bedd: References in the tree: a tree array can mix items with references to documents, at any depth.

  - References are leaves: they can't hold children, nothing can be dropped into one (also while
    dragging), and they move anywhere a reference is allowed, keeping `_ref`, `_weak` and
    `_strengthenOnPublish`.
  - They're edited in their row, without a dialog: a picked reference shows the document's preview
    and status (click it to open the document in a pane), with a pencil to replace it; an empty one
    shows the Studio's reference search, without its Create button. Adding a reference focuses
    its search.
  - Opening a nested reference no longer opens its parent item's dialog.

## 2.0.0

### Major Changes

- Requires Sanity Studio v6. Uses `@sanity/ui` 4 and `@sanity/icons` 5 natively, as peer
  dependencies shared with the Studio. On Sanity Studio v5, stay on `sanity-plugin-sortable-tree@^1`.

## 1.x

Sanity Studio v5 support. See the [GitHub releases](https://github.com/dennisregalado/sanity-plugin-sortable-tree/releases)
for details.
