# Native-style dragging: before / after

Each image shows the same moment of a pointer drag of "Contact" (same pointer offsets) in:
the Studio's own array input (the target), the tree before this change, and the tree after.

| Moment | Light | Dark |
| --- | --- | --- |
| Picked up | [1-lifted.light](1-lifted.light.png) | [1-lifted.dark](1-lifted.dark.png) |
| Moved up one row | [2-up-one-row.light](2-up-one-row.light.png) | [2-up-one-row.dark](2-up-one-row.dark.png) |
| Mid-slide (70 ms after moving) | [3-sliding.light](3-sliding.light.png) | [3-sliding.dark](3-sliding.dark.png) |
| Moved up two rows | [4-up-two-rows.light](4-up-two-rows.light.png) | [4-up-two-rows.dark](4-up-two-rows.dark.png) |
| Dropped | [5-dropped.light](5-dropped.light.png) | [5-dropped.dark](5-dropped.dark.png) |

`validation-*.png`: the same moments in documents with validation errors (Studio vs. tree after).

Regenerate the frames with `node dev/e2e/drag-frames.mjs <dir>` while `npm run dev` runs.
