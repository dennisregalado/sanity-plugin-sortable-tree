---
'sanity-plugin-sortable-tree': minor
---

References in the tree: a tree array can mix items with references to documents, at any depth.

- References are leaves: they can't hold children, nothing can be dropped into one (also while
  dragging), and they move anywhere a reference is allowed, keeping `_ref`, `_weak` and
  `_strengthenOnPublish`.
- They're edited in their row, without a dialog: a picked reference shows the document's preview
  and status (click it to open the document in a pane), with a pencil to replace it; an empty one
  shows the Studio's reference search, without its Create button. Adding a reference focuses
  its search.
- Opening a nested reference no longer opens its parent item's dialog.
