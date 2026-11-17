---
'sanity-plugin-sortable-tree': patch
---

Smoother dragging in long trees: rows that stay off-screen jump to their new place instead of sliding, rows whose only change is their position no longer re-render, and the drop no longer forces an extra layout
