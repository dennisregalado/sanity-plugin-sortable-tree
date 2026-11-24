---
'sanity-plugin-sortable-tree': minor
---

**New**

- `options.childrenField`: nested items can live in a field other than `children` (e.g. `subpages`).
- `validateTreeDepth()`: a custom validation rule that flags items nested deeper than `maxDepth` (e.g. written through the API), with the error on the item's own row. It reads `maxDepth` and `childrenField` from the field's options.
- The items you expand or collapse are remembered in the browser (per user, document and field) for the next time you open the document. The document itself still never changes.

**Fixes**

- Read-only trees (read-only fields or documents, the published perspective, releases) open their items again, to read their fields, and read-only references open their document in a pane. Their rows are no longer greyed out.
- Items nested deeper than `maxDepth` show in the tree instead of as blank rows, so they can be moved up or removed.
- The validation icon on a reference row no longer opens its replace search.
- Editing an item no longer re-renders every row of the tree: only the edited item and the items around it.
