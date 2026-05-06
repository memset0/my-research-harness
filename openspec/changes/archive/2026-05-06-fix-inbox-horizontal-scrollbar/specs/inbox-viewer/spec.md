## ADDED Requirements

### Requirement: No horizontal scrollbar on the detail pane

The inbox-shell's detail pane SHALL NOT produce a horizontal
scrollbar at any of its scroll-context layers (the right `<main>`
wrapper or the inner content scroll `<div>` that wraps the rendered
markdown). Internal horizontal scroll affordances on individual
content elements (e.g. the `<pre>` produced by a fenced code block)
are unaffected — those are correct at their own level.

To prevent the CSS Overflow Module 3 "auto-x trap"
(`overflow-y: auto` implies `overflow-x: auto` when the other axis
is `visible`), the implementation SHALL pair `overflow-y-auto`
with an explicit `overflow-x-hidden` on each layer that scrolls
vertically.

#### Scenario: Reports detail produces no horizontal scrollbar
- **GIVEN** the user opens `/p/<project>/reports/<id>` with any
  report content (including reports whose body has a fenced code
  block whose lines exceed the rendered area's width)
- **WHEN** the page renders
- **THEN** the inbox-shell's right `<main>` element carries both
  `overflow-y-auto` AND `overflow-x-hidden`
- **AND** the inner content-scroll `<div>` (the one with
  `min-w-0 flex-1`) carries both `overflow-y-auto` AND
  `overflow-x-hidden`
- **AND** the `<pre>` block's own `overflow-x: auto` (from the
  prose typography defaults) is preserved

#### Scenario: Digests detail produces no horizontal scrollbar
- **GIVEN** the user opens `/p/<project>/digests/<id>` with any
  digest content
- **WHEN** the page renders
- **THEN** the same `overflow-x-hidden` pairing applies (the same
  inbox-shell powers Digests)
