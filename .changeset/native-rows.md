---
'sanity-plugin-sortable-tree': minor
---

Tree rows are now the Studio's own array items.

Each row renders the Studio's array item (through `renderDefault`, public APIs only), next to the
tree's drag handle, expand/collapse chevron and "Add nested item" button. Items open in the
Studio's dialog from the row itself, and the plugin no longer renders a hidden copy of the default
array input to host the dialogs.

**New**

- An item menu (⋯) on every row: Remove, Copy, Duplicate, Add item before, Add item after. It
  works on nested items too, and follows the tree's `disableActions` (`'add'` also disables
  Duplicate).
- Presence avatars on rows other people are editing, and the Studio's change indicators.
- Read-only items open in a read-only "View" dialog.

**Visible changes**

- The ⋯ menu replaces the hover-only Edit (pencil) and Remove (trash) buttons. Click a row to edit
  it.
- The hover border and the error/warning tone cover the item's card, not the drag handle and
  chevron. A row's card keeps a focus-colored border while its dialog is open.
- Rows are 6px shorter (45px instead of 51px).
- The validation icon is the Studio's, with its summary tooltip, and is no longer a button. A row
  shows errors inside its nested items even when it's expanded (it used to only while collapsed),
  and malformed nested data now also shows the Studio's validation error on its parent.
- Read-only rows use the Studio's read-only look (a grey card) instead of dimmed text.
- When items can be nested, every row keeps room on its right for the "Add nested item" button, so
  the cards don't change width when it appears on hover.
- Nested lists no longer replay their expand animation when long trees mount rows while scrolling.
