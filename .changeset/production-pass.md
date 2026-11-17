---
'sanity-plugin-sortable-tree': minor
---

Production pass: safer edits, Sanity-native behavior, translations.

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
- Strings are translatable through the `sortable-tree` locale namespace (exported as
  `sortableTreeLocaleNamespace`), with an English bundle.
- Accessible labels for icon buttons, and localized screen reader announcements while dragging.
- Fewer re-renders: hovering and editing no longer re-render the whole tree.
- Uses only public Sanity APIs (no more `SanityDefaultPreview`).

**Types**

- `SortableTreeInput` takes `ArrayOfObjectsInputProps` (it was needlessly generic).
- `Item` allows any field (`[field: string]: unknown`), matching real array items.
- The `react` peer range is `^19.2`, which Sanity Studio v6 already requires.
