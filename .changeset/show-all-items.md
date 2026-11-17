---
'sanity-plugin-sortable-tree': minor
---

Long lists show their first items and "Show all N items", like the Studio's own arrays. Every list collapses on its own (the root and each item's nested items), after the array field's `options.collapseItemsAfter` (the tree field for the root, the `children` field for nested lists; `false` never collapses), or the workspace's `form.arrays.collapseItems` (4 by default). A list opens when an item is added to it or the Studio focuses one of its hidden items. The "Expand all" and "Collapse all" buttons are gone.
