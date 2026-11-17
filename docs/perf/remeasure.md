# Drag performance after native drag: re-measure

Re-measures drag performance after the native drag merge (`820937e`). That merge removed the drag
overlay: the dragged row is lifted with dnd-kit's Feedback plugin and the other rows slide aside
with a FLIP animation (`src/use-drag-flip.ts`).

**Short version**

- The native drag merge made long trees much slower. In the 500-item tree, long-task time went
  from about 2.5 s to 13.4 s, the drop from 0.9 s to 2.3 s, and the worst frame from 0.57 s to
  1.45 s. The cause was layout thrashing in `useDragFlip.play()`: for each row it read styles and
  layout right after cancelling or starting the previous row's animation. That forced a style
  recalculation and a layout per row, on every projection change.
- Fixed in `0ec67bd` (_measure all rows before starting their slides_). The animations are the same:
  all 20 drag-frame captures (light and dark, with and without validation, including the mid-slide
  frame) are pixel-identical before and after.
- With that fix, compared with the commit just before native drag (`7848435`) on the same machine:
  - **Drag start got faster**, as hoped: 11 items 555 → 342 ms (−38%), 500 items 629 → 572 ms (−9%).
  - **Long trees are still heavier while dragging and at drop**: long-task time +19%
    (2.58 → 3.08 s), frames over 50 ms 22 → 43, drop 877 → 1,081 ms (+23%).
  - Most of what's left is the browser's own style, paint and compositing work for the row slides.
    Each projection change slides every mounted row that moved, most of them off-screen. Skipping
    slides for rows that stay off-screen measured −15–25% long-task time and about −40% janky frames
    (recommendation 2). It isn't committed because it could change pixels during auto-scroll.
- Part of each cold measurement is first-interaction cost owned by the Studio, not the tree.
  Examples: the CSS rules for the document's "saving" status UI on the first edit, and a field
  header measuring itself when the field gains focus. This cost is about 210 ms of the 11-item
  drag start and about 350 ms of the 500-item drop. See "Warm runs".

## Method

- `npm run perf -- <url> 4` (`dev/e2e/perf.mjs`, unchanged since `fc78e2b`): Chromium from
  Playwright 1.63, 4× CPU throttling, viewport 1100×1400, fixtures "main menu (11 items)" (drags
  _Contact_) and "500 items" (drags _Group 3_, windowed).
- Production: `npx sanity build --yes <dir>` in `dev/`, then `npx sanity preview <dir>`. Older commits
  were built from git worktrees with the same `node_modules` and served against the same fake lake,
  so every number in the same-machine columns comes from one machine and one session.
- Medians over 3 runs (6 for `0ec67bd`), with the range in parentheses. Run-to-run spread is large
  for the 500-item long-task total and drop. Read differences under about 15% as noise.
- Causes: CDP `Profiler` CPU profiles (200 µs sampling) of three phases. _Start_ is pointer down
  plus 4 px of movement, then 800 ms. _Drag_ is the 120-move sweep. _Drop_ is pointer up, then
  1.8 s. These were taken on an unminified production build (`--no-minify --source-maps`), with
  every sample mapped back to its source package or file through the source maps. Supporting data:
  - Chrome traces (`devtools.timeline`) for the rendering pipeline: style, layout, paint, layerize,
    commit.
  - A React commit hook that counts component renders per phase.
  - Counters wrapped around `getBoundingClientRect`, `getComputedStyle`, `Element.animate` and
    `CSSStyleSheet.insertRule`.
- Profiled times are at 4× throttling, like the perf numbers. "Busy" is sampled non-idle main-thread
  time in the phase window, so it includes frame rendering, not only long tasks.

## Before and after

Production build, 4× CPU throttling, cold runs (the drag is the first interaction with the document).

|                            | Before any perf work (given) | `fc78e2b` windowing, overlay (given) | `fc78e2b` (re-measured here) | `7848435` last commit before native drag | `820937e` native drag | **`0ec67bd` native drag + FLIP fix** |
| -------------------------- | ---------------------------- | ------------------------------------ | ---------------------------- | ---------------------------------------- | --------------------- | ------------------------------------ |
| 11 items: worst frame      | 500                          | 333–367                              | 367 (283–383)                | 300 (283–300)                            | 350 (300–383)         | **325** (300–417)                    |
| 11 items: long-task total  | 1,249                        | 804–1,107                            | 925 (865–1,063)              | 897 (864–909)                            | 764 (694–782)         | **730** (680–777)                    |
| 11 items: drag start       | n/a                          | ~465                                 | 618 (542–633)                | 555 (534–568)                            | 363 (320–394)         | **342** (295–428)                    |
| 11 items: drop             | n/a                          | 0 (no write)                         | 72 (70–89)                   | 80 (78–86)                               | 109 (93–155)          | **101** (81–161)                     |
| 11 items: frames > 50 ms   |                              |                                      | 4                            | 4                                        | 3                     | **3**                                |
| 500 items: frame p50 / p95 | 50 / 133                     | 16.7 / 50–67                         | 16.7 / 50 (50–67)            | 16.7 / 50 (50–50)                        | 16.7 / 283 (83–400)   | **16.7 / 67–83**                     |
| 500 items: worst frame     | 4,017                        | ~550–567                             | 533 (517–567)                | 567 (567–617)                            | 1,450 (1,233–1,667)   | **717** (667–800)                    |
| 500 items: frames > 50 ms  |                              |                                      | 22 (15–27)                   | 22 (14–25)                               | 53 (37–60)            | **43** (40–54)                       |
| 500 items: long-task total | 12.5 s                       | ~2.3–2.9 s                           | 2.45 s (2.01–2.55)           | 2.58 s (2.11–2.64)                       | 13.4 s (9.8–21.8)     | **3.08 s** (2.60–3.95)               |
| 500 items: drag start      | n/a                          | ~663                                 | 660 (656–674)                | 629 (616–634)                            | 738 (720–783)         | **572** (525–660)                    |
| 500 items: drop            | n/a                          | ~715                                 | 809 (701–869)                | 877 (818–919)                            | 2,297 (2,210–2,884)   | **1,081** (964–1,290)                |
| 500 items: initial render  | 4.3 s                        | ~2.0 s                               | 1.97 s (1.96–2.07)           | 1.86 s (1.80–2.05)                       | 2.14 s (2.06–2.16)    | **1.94 s** (1.79–2.05)               |

Times in ms unless marked. "Drag start" and "drop" are long-task time in the 600 ms after pointer
down, and after pointer up. In this session `fc78e2b` measured close to the given numbers. Its
11-item drop was 70–89 ms, so that drop did write a change here.

### Dev server (`npm run dev`, React development build)

|                                         | `820937e` native drag               | `0ec67bd` + FLIP fix                |
| --------------------------------------- | ----------------------------------- | ----------------------------------- |
| 11 items: worst frame / long-task total | 433 (367–467) / 959 (848–976)       | 450 (350–483) / 985 (856–1,027)     |
| 11 items: drag start / drop             | 458 (376–477) / 117 (103–119)       | 464 (367–498) / 115 (110–142)       |
| 500 items: frame p95 / worst frame      | 400 (217–433) / 2,383 (2,383–2,433) | 183 (150–183) / 1,333 (1,300–1,383) |
| 500 items: long-task total              | 24.0 s (23.4–24.9)                  | 11.7 s (8.3–12.7)                   |
| 500 items: drag start / drop            | 722 (661–786) / 3,531 (3,308–3,742) | 634 (629–772) / 2,074 (1,711–2,345) |
| initial render (11 / 500)               | 3.6 s / 3.6 s                       | 3.3 s / 3.8 s                       |

The development build is 2–4× slower than production, mostly because of React's dev-mode work. The
fix halves the 500-item long-task time there too.

### Warm runs (production, `0ec67bd`)

Same script, but with one unmeasured short drag and drop first, so the measured drag isn't the
first interaction and the measured drop isn't the document's first edit:

|                                          | Cold (table above) | Warm                               |
| ---------------------------------------- | ------------------ | ---------------------------------- |
| 11 items: drag start / drop              | 342 / 101          | 131 (120–156) / 88 (86–137)        |
| 11 items: worst frame / long-task total  | 325 / 730          | 167 (150–183) / 268 (206–298)      |
| 500 items: drag start / drop             | 572 / 1,081        | 512 (466–525) / 727 (565–1,022)    |
| 500 items: worst frame / long-task total | 717 / 3.08 s       | 400 (333–433) / 1.84 s (1.53–2.14) |

### A drag that reorders, 11 items (production, `0ec67bd`, cold)

_Contact_ is the last row of the main menu, so the perf script's 11-item drag never reorders
anything: the tree didn't re-render once during the sweep. That metric mostly measures dnd-kit's
pointer tracking. Dragging _Home_ down 6 rows instead (scratch copy of the script, same steps):
drag start 317 (308–379), drop 491 (415–561), long-task total 1,084 (968–1,260), worst frame 367
(317–400), 6 frames over 50 ms.

## What still costs time

All profiles below are of `0ec67bd` unless noted.

### The regression that was fixed (`820937e` → `0ec67bd`)

500-item drag at `820937e`, 27.1 s busy:

| Self time   | Where                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- |
| 9.6 s (35%) | `getSlideOffset` (`getComputedStyle(el).translate`) ← `play` ← layout effect in `Tree` |
| 4.5 s (17%) | `getBoundingClientRect` ← `play`                                                       |

That's 76,898 `getComputedStyle` and 23,314 `getBoundingClientRect` calls in one drag. Each one
followed an `animation.cancel()` or `element.animate()`, so each recalculated styles or layout for
the whole document. After the fix, the same drag is 11.3 s busy, and `useDragFlip` as a whole is
0.61 s of it.

### Drag start

**11 items, cold (≈340 ms of long tasks)**: 527 ms busy in the start window.

|     | Cost                                                                                                                                                                                                        | Owner   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | 136 ms (26%): dnd-kit activation. `handleStart` → `FrameObserver` / `PositionObserver` measure the source row right after it's lifted into the top layer, which forces layout.                              | dnd-kit |
| 2   | 81 ms (15%): `FormFieldBaseHeader`'s effect (Studio field chrome) measures its floating card with `getBoundingClientRect` when the field's focus or hover state flips at pointer down, which forces layout. | Studio  |
| 3   | 98 ms browser style, layout and paint; 44 ms React.                                                                                                                                                         |         |
|     | FLIP: 12 ms. Nothing slides when the last row is lifted.                                                                                                                                                    | plugin  |

Warm, the same drag start is 131 ms. Most of the cold cost is first-interaction work: Studio field
chrome, the first styled-components rules for the lifted and pressed states, and JIT warm-up.

**500 items, warm (≈510 ms)**: 1.25 s busy in the start window.

|     | Cost                                                     | Cause                                                                                                                     |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | 280 ms (22%): browser style, layout and paint            | Lifting the row; _Group 3_'s 4 descendants leave the list; the rows below move up.                                        |
| 2   | 254 ms React + 130 ms styled-components (31%)            | Rows whose index shifted re-render: 23 `TreeItem`, 65 `Button`, 61 `Card`, 42 `Tooltip`, 45 `CollapsibleSubtree` renders. |
| 3   | 191 ms `getBoundingClientRect` + 72 ms JS (21%): dnd-kit | `PositionObserver` re-measures the droppables after the list changes. `Sortable.register` / `unregister`: 56 ms.          |
| 4   | 47 ms: FLIP                                              | Snapshot and slides for the rows moving up.                                                                               |

The test row is at y ≈ 1,135 in a 1,400 px viewport, so dnd-kit's auto-scroll starts immediately
in the 500-item case. In cold runs, each scroll event also runs the virtualizer of the Studio's
default array input. The tree renders that input hidden, so item dialogs keep working. Its
`handleScroll` forces a layout: 153 ms. An experiment that removed the hidden input changed no
total measurably, so it isn't a lead.

### During the drag (500 items, 120 pointer moves, 11.3 s busy)

| Rank | Cost                                                        | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 3.87 s (34%): browser style, layout, paint and compositing  | Mostly the row slides. Each projection change starts a slide on every mounted row that moved (3,359 slide animations in this drag), most of them off-screen. Each slide is a composited layer that's restyled every frame.                                                                                                                                                                                                                                                 |
| 2    | ≈2.7 s (24%): dnd-kit                                       | Position updates 0.90 s (collisions, moving the lifted row). `DOMRectangle` shape measuring 0.88 s, including `document.getAnimations()` / `forceFinishAnimations` 0.35 s and `element.getAnimations()` 0.12 s, which grow with the number of running slides. Observers re-measuring shapes 0.53 s. `elementFromPoint` 0.21 s. `Sortable.register` 0.28 s, for rows that remount when the dragged row changes parent list and for rows windowing mounts as they scroll in. |
| 3    | 1.56 s React + 0.82 s styled-components and Sanity UI (21%) | 17 `Tree` renders, 32 `TreeItem`, 249 `CollapsibleSubtree`, 121 `Button`. styled-components' render function alone is 667 ms, regenerating class names for `Card`, `Button` and `Box`.                                                                                                                                                                                                                                                                                     |
| 4    | 0.61 s (5%): `useDragFlip`                                  | `snapshot` 0.30 s: it runs in `onDragOver`, right after dnd-kit has moved the lifted row, so its first read forces layout. `play` 0.31 s.                                                                                                                                                                                                                                                                                                                                  |
| 5    | 0.45 s (4%)                                                 | The hidden default array input's virtualizer `handleScroll` during auto-scroll (see above).                                                                                                                                                                                                                                                                                                                                                                                |

The rendering pipeline from Chrome traces, same drag, before native drag vs now:

| Pipeline stage                           | `7848435` (overlay)   | `0ec67bd`                |
| ---------------------------------------- | --------------------- | ------------------------ |
| Style recalculation (`UpdateLayoutTree`) | 456 ms, 6.7k elements | 1,474 ms, 51.1k elements |
| Layerize                                 | 733 ms                | 1,055 ms                 |
| Paint                                    | 205 ms (720 paints)   | 834 ms (3,777 paints)    |
| Commit                                   | 499 ms                | 799 ms                   |
| Layout                                   | 355 ms                | 761 ms                   |
| PrePaint                                 | 163 ms                | 599 ms                   |
| IntersectionObserver                     | 303 ms                | 424 ms                   |
| **Total**                                | **≈2.7 s**            | **≈5.9 s**               |

The extra ≈3.2 s is the row slides. That matches the off-screen-slide experiment
(recommendation 2) bringing frames over 50 ms back to 19–31.

**11 items**: the tree doesn't re-render during the sweep (121 commits, all outside the tree, 0
`TreeItem` renders). That's 1.14 s busy: 338 ms browser, 272 ms React (Studio components), about
400 ms dnd-kit pointer tracking (`elementFromPoint` 99 ms).

### Drop

**500 items, cold (≈1,080 ms)**: 2.6 s busy in the drop window, including the drop animation and
the form update.

|     | Cost                                                                    | What                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ≈350 ms: first edit (cold − warm)                                       | Studio-owned. On the document's first edit, the Studio shows its status UI (badge, spinner), and styled-components inserts 13 new CSS rules. Inserting rules invalidates styles for the whole document: the drop's style recalculation covers 14.2k elements. |
| 2   | 782 ms (30%): browser style, layout and paint                           | The row is put back into the list, its children come back, the slides start, and the form re-renders.                                                                                                                                                         |
| 3   | 426 ms React + 256 ms styled-components (26%)                           | The dragged row's children come back, so every row after it shifts index again; then the form value changes. Warm: 64 `TreeItem`, 194 `Button`, 111 `Tooltip` renders.                                                                                        |
| 4   | 193 ms JS + 144 ms `getBoundingClientRect` (13%): `useDragFlip` at drop | Its first read forces the drop commit's layout.                                                                                                                                                                                                               |
| 5   | 140 ms: dnd-kit drop animation                                          | `getFinalKeyframe` → `getAnimations()`                                                                                                                                                                                                                        |
| 6   | 123 ms: `RestrictToList` (`src/drag-feedback.ts`)                       | It reads the tree's `getBoundingClientRect()` while dnd-kit's Feedback cleanup computes the final transform, after the DOM changed, so it forces a layout.                                                                                                    |

**11 items (≈100 ms)**: 248 ms busy, of which 70 ms is the same `RestrictToList` forced layout and 90
ms is browser rendering.

## Recommendations

Ranked by expected gain for the 500-item tree. Gains are at 4× throttling, production build.

| #   | Change                                                                                                                                                                                                                                                                                                               | Expected gain                                                                                                                                                                                                                        | Effort                                                                                                  | Visual change?                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Done (`0ec67bd`)**: in `useDragFlip.play()`, measure every row first, then cancel and start the slides.                                                                                                                                                                                                            | 500 items: long tasks 13.4 → 3.1 s, drop 2.3 → 1.1 s, worst frame 1.45 → 0.72 s.                                                                                                                                                     | Done                                                                                                    | None. 20/20 drag frames pixel-identical.                                                                                                                                                                                |
| 2   | **Skip the slide for rows that are off-screen both before and after the move** (when both positions are above, or both below, the visible area). The decision can use the rects `play` already reads.                                                                                                                | Measured with an experiment: long tasks 2.31–2.50 s vs 2.60–3.95 s (−15–25%), frames over 50 ms 19–31 vs 40–54, p95 50–67 ms. Also less `getAnimations()` work inside dnd-kit. Brings the drag back to about pre-native-drag levels. | Small (~10 lines)                                                                                       | None in a still viewport. During an auto-scroll that happens within a 200 ms slide, a row scrolled into view would already be in place instead of mid-slide. Needs a screenshot check, so it's proposed, not committed. |
| 3   | **Don't re-render rows when only their index shifts.** Drop `index` from `TreeItem`'s memo comparison, or pass a stable index. With the sortable plugins off and `transition: null`, dnd-kit 0.5.3 uses `index` only for its sorting plugins, its index-change transition and `move()`, none of which the tree uses. | Measured with an experiment: warm 500-item drag start 375–417 vs 466–525 ms (−~100 ms, −20%). Probably part of the drop's row re-renders too, but cold drops were too noisy to show it.                                              | Small, but relies on dnd-kit internals. Should come with an e2e check of pointer and keyboard reorders. | None                                                                                                                                                                                                                    |
| 4   | **Don't force layout in `RestrictToList`.** Use the tree rect dnd-kit already measured, or cache the rect per frame and invalidate it on projection changes.                                                                                                                                                         | ~70–120 ms at drop, plus a little per move.                                                                                                                                                                                          | Small to medium. The tree's height changes mid-drag, so the cache must follow it.                       | None if the rect stays correct.                                                                                                                                                                                         |
| 5   | **Mount row tooltips only on hover or focus.** Each row mounts 2–4 Sanity UI `Tooltip`s; at drop they account for 111 of the re-renders.                                                                                                                                                                             | Estimated 10–20% of the React + styled-components time at drag start and drop (~50–100 ms).                                                                                                                                          | Medium                                                                                                  | Should look identical, but the first show of a tooltip could time differently. Needs screenshots.                                                                                                                       |
| 6   | **Smaller windowing margin while dragging** (800 px → ~400 px). Fewer mounted rows means fewer droppables to measure and fewer slides.                                                                                                                                                                               | Estimated −20–30% of the dnd-kit and slide costs.                                                                                                                                                                                    | Small                                                                                                   | Yes: fast scrolling could briefly show empty placeholders. Proposed only.                                                                                                                                               |
| 7   | **Studio-owned costs** (report upstream, not fixable here): first-edit status UI CSS rules invalidating every style (~350 ms at the first drop); `FormFieldBaseHeader` measuring in an effect when field focus changes (~80 ms at pointer down); the array virtualizer forcing layout on scroll.                     | none here                                                                                                                                                                                                                            | none                                                                                                    | none                                                                                                                                                                                                                    |
| 8   | **Perf script**: add a case that reorders in the 11-item tree (e.g. drag _Home_), and a warm run, so the first-interaction cost is reported separately. Not changed here, so the numbers stay comparable with earlier runs.                                                                                          | Better signal                                                                                                                                                                                                                        | Small                                                                                                   | none                                                                                                                                                                                                                    |

Checked and ruled out:

- Removing the hidden default array input changed nothing measurable.
- dnd-kit 0.5.3 is the latest release, so there's no upgrade to try.
- `getSlideOffset`'s `getComputedStyle` is cheap once reads are batched (82 ms over the whole
  drag), so skipping it for rows without a running slide isn't worth the complexity.
