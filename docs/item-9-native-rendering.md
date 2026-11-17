# Item 9: native rendering of tree rows

Scoping study and prototype for rendering each tree row as a real Studio array item. Based on
`sanity` 6.23.0 (installed build and its source maps) and the plugin at `492c096`.

- Prototype diff: [`item-9/spike.patch`](item-9/spike.patch). It applies on `492c096`, is about
  120 changed lines, and is not mergeable as is.
- Screenshots: [`item-9/`](item-9/). Each comparison shows **before on the left and the prototype
  on the right**, at half of the 2× capture size.

## Verdict

**It's possible with public APIs, with one caveat.** The tree already renders each row
through `ArrayOfObjectsItem`, and only overrides the item's `components.item` to draw just the
preview. If that override calls `props.renderDefault(...)` instead, with a few props replaced,
every row becomes the Studio's own `PreviewItem`. That brings the card, presence avatars,
validation status, the item menu (remove, copy, duplicate, insert before/after), the change
indicator and the edit dialog, all opening from the visible row. The hidden copy of the default
array input can then be removed. The prototype does this, and the dialogs, including nested ones,
look exactly as they do today. Nothing internal is needed: the props that are replaced
(`parentSchemaType`, `open`, `onOpen`, `onRemove`, `onInsert`) are all fields of the `@public`
`ObjectItemProps`.

**The caveat is that the look does not stay the same.** The native card is one unit (preview
button, presence, validation, ⋯ menu), and its pieces aren't exported separately: `FieldPresence`,
`ContextMenuButton`, `FormFieldValidationStatus` and `ChangeIndicator` are all `@internal`, and
`useChildPresence` and `useChildValidation` aren't exported at all. So the tree can put its handle
and chevron next to the card, but not inside it. The ⋯ menu is visible on every row. The hover
border, the error tone and the "selected" outline cover the card only, not the handle and chevron.
Rows are also about 8px shorter. These changes are listed in full
[below](#what-the-user-would-see-change) for approval. Keeping today's look exactly would mean
reimplementing presence and the menu with internals, which this item exists to avoid.

## The approach

Line numbers refer to the 6.23.0 sources (from `node_modules/sanity/lib/*.js.map`). Paths are
relative to `packages/sanity/src/core/form/` in
[sanity-io/sanity](https://github.com/sanity-io/sanity/tree/main/packages/sanity/src/core/form).
The release tags come from `node_modules/sanity/lib/*.d.ts`.

### How the Studio item pipeline works (what we rely on)

| Piece | Where | Tag |
| --- | --- | --- |
| `ArrayOfObjectsItem({member, render*})` builds `ObjectItemProps` from the member, and calls `renderItem`, which resolves `schemaType.components.item` | `members/array/items/ArrayOfObjectsItem.tsx:73-474` | `@hidden @beta` (exported) |
| `ArrayOfObjectsItemMember`: `member.open`, `member.item.{path,focused,presence,validation,…}`, `member.parentSchemaType` | `store/types/members.ts` | `@hidden @beta` (exported) |
| `ObjectItemProps` (`open`, `onOpen`, `onClose`, `onRemove`, `onInsert`, `onCopy`, `parentSchemaType`, `children`, `renderDefault`) | `types/itemProps.ts` | `@public` |
| Default item = `PreviewItem`: `RowLayout` card + presence (`useChildPresence(path, true)`, l.147) + validation (`useChildValidation(path, true)`, l.154) + menu (l.178-247) + `EditPortal`/`EnhancedObjectDialog` when `open` (l.318-351) | `inputs/arrays/ArrayOfObjectsInput/List/PreviewItem.tsx` | internal (reached only through `renderDefault`) |
| The native drag handle is shown when `parentSchemaType.options.sortable !== false` (l.92, l.273) and uses legacy `@dnd-kit/sortable` with the internal `SortableItemIdContext` | `PreviewItem.tsx:92`, `layouts/RowLayout.tsx:79`, `common/DragHandle.tsx:148-151` | internal |
| An item is `open` when `startsWith(itemPath, openPath)`, so **every ancestor of the open item is open too** | `store/formState.ts:1364` | n/a |
| `onPathOpen` / `onPathFocus` take **absolute** paths. `onChange` comes from `useFormCallbacks()` and is **relative to the nearest array field**: `ArrayOfObjectsField` prefixes patches with the field name (l.154-174) and provides a new context (l.579), and `ArrayOfObjectsItem` prefixes with `{_key}` (l.233-242, l.410) | `members/object/fields/ArrayOfObjectsField.tsx`, `studio/contexts/FormCallbacks.tsx` | `FormCallbacksProvider` / `useFormCallbacks` are `@internal` |
| `insert`, `unset`, `setIfMissing` patch helpers | `patch/patch.ts` | `@hidden @beta` (already used by the plugin) |

The last two rows are the crux. Root rows are rendered inside the tree input, where the form
callbacks context is the root array's, so `ArrayOfObjectsItem`'s own `onRemove`/`onInsert`
(`unset([{_key}])`, `insert(…, [{_key}])`) patch the right place. **Nested rows don't.** Their
patches would be applied to the root array with a key that isn't there, and nothing would happen.
Wrapping nested rows in a corrected `FormCallbacksProvider` would fix that, but it's `@internal`.
The approach below avoids it.

### Step by step

1. **Item override that delegates to the Studio** (`src/member-preview.tsx`). Replace
   `TreeItemInput` (which returns `inputProps.renderPreview(...)`) with a component that returns
   `props.renderDefault({...props, ...overrides})`, where the overrides are:
   - `parentSchemaType`: a cached clone with `options.sortable: false`, which hides the native drag
     handle (`PreviewItem.tsx:92`). Add `'duplicate'` to `options.disableActions` when the tree
     disallows `'add'`. The Studio treats duplicate as its own action, so with
     `disableActions: ['add', 'remove']` the prototype still offers Duplicate (see
     `options-hover.png`).
   - `open`: `props.open` for **root rows only**, `false` for nested rows. Because ancestors are
     open too (`formState.ts:1364`), the root row's dialog renders the item's object input, whose
     `children` field renders the nested item's dialog, stacked with breadcrumbs. This is exactly
     what the hidden input gives today. Letting nested rows host dialogs as well would mount the
     nested dialog twice.
   - `onOpen`: the tree's `handleItemOpen` (opens the item and focuses its first field, as
     today).
   - `onRemove`: the tree's `handleRemove`, which knows the full path and clears collapse state.
   - `onInsert({items, position})`: a new tree handler that sends
     `insert(items, position, fullItemPath)` and opens the new item. Duplicate already passes
     items with deep-regenerated keys (`utils/regenerateKeys.ts`). Insert before/after passes a
     proto value (`createProtoArrayValue`), so the handler must also resolve initial values, as
     `handleAddItem` does today. The prototype skips this.
   - `onCopy` is left alone: it uses the absolute `member.item.path` and works at any depth.

   The tree passes its per-row actions to the override through a small React context
   (`TreeRowContext`), since `ItemProps` can't carry extra props.

   The preview override (`TreeItemPreview`, compact layout, "Untitled") stays and still applies,
   because `PreviewItem` renders the preview through `renderPreview` → `components.preview`.
2. **Row** (`src/tree-item.tsx`). Keep the outer sortable `div`, the tree's drag handle, the chevron
   and the add-child button. Replace the preview button, validation button, Edit and Remove with
   the native item. The outer `Card` loses its border, hover and validation tone, because the
   native card has its own.
3. **Remove the hidden input** (`src/input.tsx`): delete the `aria-hidden` box with
   `props.renderDefault(props)`.
4. **Delete the approximations.** `src/validation.ts` (`collectValidation`), the validation
   tooltip, the Edit and Remove buttons, the hover and focus state used only to show them, and
   their i18n keys. Keep `MemberPreview` for the drag overlay, which should stay a light preview.
5. **Tests.** Update `dev/e2e/interactions.mjs`: removal goes through the ⋯ menu
   (`data-testid="array-item-menu-button"`). Add e2e tests for duplicate, insert before/after and
   copy on a **nested** row, asserting the patch paths, and a test that a nested row's dialog opens
   only once.

### Verified in the prototype

- Clicking a root row or a nested row opens the Studio dialog, identical to today (compare
  `dialog-after.png` with the `main-dialog` screenshot). There is no hidden input, and no
  `aria-hidden` focusable controls.
- ⋯ → Remove on nested "Sale" sends `unset` at `items[shop].children[sale]`.
- ⋯ → Duplicate on nested "Women" inserts a copy with new keys (its children's too) right after
  it, and opens it. Root Duplicate works too.
- ⋯ → Copy runs (the headless browser only blocked clipboard access).
- 7 of the 8 e2e tests pass. The failure is the remove test, which clicks the old trash button.

## What the user would see change

Each change below needs the owner's approval. Screenshots: before on the left, prototype on the
right.

| # | Change | Screenshot |
| --- | --- | --- |
| 1 | A **⋯ menu button on every row, always visible** (Remove, Copy, Duplicate, Add item before/after). It replaces the hover-only Edit and Remove buttons. | `main-hover.png`, `main-hover-dark.png` |
| 2 | **The Edit (pencil) button goes away.** Clicking the row opens the dialog, as in the Studio's array input. | `main-hover.png` |
| 3 | **The hover border and the error/warning tone cover the native card only**, not the drag handle and chevron. A focus-ring border also stays on the card while its dialog is open (`aria-selected`). | `main-hover.png`, `validation.png` |
| 4 | **Rows are about 8px shorter** (47px vs 55px at 1×). The preview also sits a few pixels further right, because the card has its own padding. | `main-hover-leaf.png` |
| 5 | **Parents show their descendants' errors even when expanded.** The Studio's `useChildValidation(path, true)` includes the whole subtree, so "Shop" turns red because of its child. Today the tree only rolls up hidden children's errors, when collapsed. | `validation.png`, `validation-collapsed.png` |
| 6 | The validation icon is the Studio's `FormFieldValidationStatus` with its summary tooltip, instead of the tree's tooltip listing up to 5 messages. It is purely an indicator: today's icon is a button that opens the item. | `validation.png` |
| 7 | **Read-only rows** get the Studio's read-only look (a grey `transparent` card, normal-weight text, no menu) instead of dimmed text, and **can be clicked to open a read-only "View …" dialog**. Today they're disabled. | `readonly.png` |
| 8 | **New: presence avatars** (one avatar, `maxAvatars={1}`) on rows other people are editing. | can't be shown offline, see below |
| 9 | **New: change indicators** (the Studio's change bar) on changed items, when the document has a published or base version to compare against. | not in fixtures |
| 10 | Previews keep the compact layout and "Untitled". The add-child "+" button stays hover-only. The drag overlay is unchanged. | `mixed.png` |
| 11 | With `disableActions: ['add', 'remove']`, the menu still shows Copy (and Duplicate unless it's also disabled, see step 1). | `options-hover.png` |

Possible mitigations, each its own decision. CSS on the native card's `data-ui` attributes could
restore the full-row hover border, but that depends on undocumented DOM. Showing the ⋯ menu only on
hover would need the same kind of CSS. Neither is recommended.

### Verifying presence

The fake lake ignores presence messages, so presence has to be tested against a real project:
`sanity dev` on a real `projectId`/`dataset` (or a deployed test studio), with two browser profiles
logged in as different users. User B opens an item's dialog (or focuses one of its fields), and
user A should see B's avatar on that row. Nested items roll up to their ancestors: B editing
"Dresses" shows on "Dresses" and on "Women" and "Shop" too, since `useChildPresence(path, true)`
includes the subtree. Also check a collapsed parent and a row inside a long list.

## Risks

**Drag-and-drop interplay.**
- The Studio's `DragHandle` runs legacy `@dnd-kit/sortable` `useSortable` against
  `SortableItemIdContext`. With `sortable: false` it's not rendered at all, so nothing native
  competes with the tree's `@dnd-kit/react` sensors. The native card's button also calls
  `preventDefault` on `mousedown` (`PreviewItem.tsx:253-255`). That matters only if the tree ever
  wanted to drag by the whole row. Today it drags by its handle only, so no conflict was seen.
- The Studio's `MOVING_ITEM_CLASS_NAME` styles (`RowLayout.tsx:28`) belong to its own list and
  don't trigger.
- If the Studio ever stopped reading `parentSchemaType.options.sortable` in `PreviewItem`, a second
  drag handle would appear. A visual e2e check catches that.

**Nested arrays inside dialogs.**
- The `children` field inside a dialog renders through the Studio's normal path (a default list
  input, or the tree if that field has `options.tree`). Its items are real items in their own
  array context, so everything works there.
- The only special case is the tree's own nested rows (see steps 1 and 2), which must never host
  dialogs. If the tree ever renders the dialog for a deep item directly, it would need a correctly
  scoped `onChange`, which means the `@internal` `FormCallbacksProvider`.
- Nested rows' `onRemove` and `onInsert` **must** be overridden. Forgetting one would make the menu
  silently do nothing.

**Focus.**
- `PreviewItem` focuses its card when `member.item.focused` becomes true (l.112-117), and
  `RowLayout` focuses its root (l.62-66). Closing a dialog returns focus to the row's card, as it
  should, instead of to the hidden input.
- `useScrollIntoViewOnFocusWithin` (l.110) scrolls the open row into view behind the dialog, which
  the hidden input never could.
- Tab order per row becomes: tree handle → chevron → card → ⋯ → (+). The keyboard-drag e2e test
  still passes.
- The existing hack that "only keyboard focus shows actions" goes away along with the hover-only
  actions.

**StrictMode.** Nothing new is in the plugin. The native pieces are what the Studio already runs in
StrictMode in dev. The one thing to watch is the tree's `TreeRowContext` value, which is memoized
per row so the native item isn't re-rendered on every tree render (see performance).

**API stability.**
- `ArrayOfObjectsItem` and `ArrayOfObjectsItemMember` are `@hidden @beta`. The plugin already
  depends on them, so this item adds no new tier.
- Everything else used is `@public` (`ObjectItemProps`, `renderDefault`) or `@hidden @beta`
  (`insert`).
- **Nothing `@internal` is needed.** Rejected because they are internal: `FormCallbacksProvider` /
  `useFormCallbacks`, `FieldPresence`, `ContextMenuButton`, `FormFieldValidationStatus`,
  `ChangeIndicator`, `useVirtualizerScrollInstance`. Not exported at all: `useChildPresence`,
  `useChildValidation`, `PreviewItem`, `VirtualizedArrayList`.
- Behaviour risk: `PreviewItem` details (layout, padding, the menu items) can change in any Studio
  minor release, and the tree's look changes with them. That is the flip side of looking native.

## Performance and virtualization

Measured on the "500 items" fixture (500 root items, 701 rows) in the dev Studio (React
development build, so absolute numbers are inflated). Three runs each, Chromium:

| | Baseline (custom rows + hidden input) | Prototype (native rows, no hidden input) |
| --- | --- | --- |
| Open the document until all rows are in the DOM | 6.3 s | 8.2-8.8 s (**+35-40%**) |
| Long-task time while mounting | 5.8-6.0 s | 8.1-8.8 s |
| DOM nodes in the field | 19,693 | 27,962 (**+42%**) |
| 30-step pointer drag: long-task time | 2.37-2.48 s | 2.54-2.60 s (**+5%**) |

What changes:
- **Mount and re-render cost per row goes up.** Each native row adds `useChildPresence`,
  `useChildValidation`, two insert-menu state machines, a `MenuButton`, a `ChangeIndicator`
  (registers with the change-connector tracker), `EnhancedObjectDialogProvider` and the extra
  `RowLayout` DOM.
- **Removing the hidden input saves little.** It was already virtualized, so it rendered only the
  rows in view.
- **Drag cost barely moves.** `TreeItem` is memoized and projected moves don't change `member`, so
  native internals don't re-render during a drag. The +5% comes from the larger DOM (layout and
  hit-testing).
- **Typing in a dialog re-renders more.** Every edit produces new `member` objects along the path,
  and presence and validation updates re-render the rows they touch. That's the same as the
  Studio's list, but without its virtualization.

**Reuse the Studio's virtualization? No: the tree needs its own.**
- `VirtualizedArrayList` isn't exported, and the scroll element comes from
  `useVirtualizerScrollInstance`, which is `@internal`.
- It virtualizes a flat member list with fixed `estimateSize`. The tree has variable-depth rows,
  collapsible subtrees and "Add item" rows between levels, so it has to virtualize its flattened
  render list itself, for example with `@tanstack/react-virtual` on the nearest scroll parent found
  in the DOM.
- The pattern worth copying is its `rangeExtractor` (`VirtualizedArrayList.tsx:101-126`). It always
  keeps the **focused** item and the **dragged** item rendered.

**What item 9 means for the parallel virtualization and drag-performance work:**
1. With native rows, **virtualization becomes more valuable** (each row costs more) and **slightly
   more constrained**. The root ancestor of the open path must stay mounted, since its row hosts
   the dialog. Unmounting it closes the dialog. The Studio does this by keeping the focused index in
   range, and the tree must keep `openPath`'s root row in range.
2. The tree's per-row actions context and `withoutSortable` clone must stay referentially stable,
   or virtualized rows that remount will re-run every native hook.
3. The drag overlay should keep using the light `MemberPreview`, not a native item.
4. Nothing in item 9 conflicts with sensors or projection: the tree's handle, `useSortable` and the
   projection logic are unchanged.

Recommendation: land virtualization first, or together with item 9. Native rows on a
non-virtualized 500-item tree are a measurable regression.

## Effort estimate

About **3-4 days** for one developer who knows the codebase, plus the owner's visual review:

| Work | Estimate |
| --- | --- |
| Native item override, row actions context, `withoutSortable` + disableActions mapping | 0.5 d |
| Tree `onInsert` with initial values and open; remove/insert at nested paths | 0.5 d |
| Row layout rework (handle/chevron next to the card, spacing, drag tone), dark mode | 0.5-1 d |
| Delete the hidden input, `validation.ts`, the old buttons and their i18n keys | 0.25 d |
| e2e: menu actions on nested rows, single dialog, focus return, updated screenshots | 0.75 d |
| Presence check on a real project; README/CHANGELOG (visible change → minor or major) | 0.5 d |

Add about 1 day if the owner wants the full-row hover border or a hover-only menu kept through
CSS.

## Recommended commit plan

1. `test(e2e): cover item actions at nested paths`. Add duplicate/insert/remove/open tests that
   assert patch paths and pass on both implementations. Use roles, not button positions, so the
   tests survive the UI change.
2. `feat: render tree rows as Studio array items`. Add the item override, `TreeRowContext`, the
   `parentSchemaType` clone, and the tree's `onInsert`/`onRemove`/`onOpen` overrides. Nested rows
   don't host dialogs. Remove the Edit, Remove and validation buttons.
3. `refactor: remove the hidden default array input`. Drop the `aria-hidden` box from
   `src/input.tsx`, and verify that dialogs, focus return and scroll-into-view work.
4. `refactor: drop the tree's own validation roll-up`. Delete `src/validation.ts` and its tests,
   and unused i18n keys and icons.
5. `style: align tree rows with the native card`. Adjust spacing and the drag tone, and decide
   mitigations, after the owner reviews the screenshots.
6. `docs: changeset and README for native rows`, listing the visible changes from the table above.

If virtualization lands separately, it should go in before commit 2, or commit 2 must include
"keep the open root row mounted".
