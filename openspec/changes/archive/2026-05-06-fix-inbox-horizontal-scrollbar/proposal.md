## Why

Opening a specific report (e.g. `/p/<project>/reports/R0001`) produces
a stray horizontal scrollbar that the user describes as "诡异"
(unexpected/uncanny). Same shell powers the digests detail page, so
the bug is shared by both.

Root cause: the inbox-shell main pane carries `overflow-y-auto` and
the inner content scroll div likewise carries `overflow-y-auto`. Per
CSS Overflow Module 3 §4.2: when one axis is set to a non-`visible`
value, the other axis's `visible` is computed to `auto`. So both of
these scroll containers ALSO have `overflow-x: auto` effectively —
which means any descendant whose box happens to exceed the
container's content width (a wide `<pre>` block, a long unbreakable
inline string, the prose's default `<pre>` overflow internals,
sticky-header layout interactions) instantly produces a horizontal
scrollbar that the user sees and didn't ask for.

The other shell direction (vertical scroll on the inner content) is
intentional and stays. The horizontal axis is never wanted at the
shell level — the prose's own `<pre>` block has its own
`overflow-x: auto` for code overflow, so we don't need a parent-
level horizontal scroll affordance.

## What Changes

- The inbox-shell's right-pane `<main>` SHALL explicitly clip
  horizontal overflow (`overflow-x-hidden`) in addition to its
  existing `overflow-y-auto`.
- The inbox-shell's inner content-scroll `<div>` SHALL likewise
  set `overflow-x-hidden` alongside its `overflow-y-auto`.
- No behavioral change for vertical scrolling, layout proportions,
  or the editor side-pane.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `inbox-viewer`: extend an existing requirement (or add one) pinning
  the no-horizontal-scrollbar invariant on the detail pane so this
  doesn't silently regress.

## Impact

- `apps/web/components/inbox-shell.tsx` — two className edits
  (the `<main>` and the inner content scroll `<div>`).
- No backend, no API, no data shape changes.
