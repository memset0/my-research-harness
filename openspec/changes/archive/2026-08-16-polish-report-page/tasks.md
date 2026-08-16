## 1. Report document surface

- [x] 1.1 Add focused inbox-shell coverage proving a loaded Report body uses
  the semantic card background across the full reading surface while a Digest
  body and non-document states keep their existing background treatment.
- [x] 1.2 Apply the Report-only `bg-card` treatment to the rendered body scroll
  surface without changing the sticky toolbar, overflow containment,
  frontmatter rendering, Markdown rendering, or dark-theme token behavior.

## 2. Desktop Report picker visibility

- [x] 2.1 Add component coverage for the desktop Report picker's default-open,
  hide, reclaimed-width, restore, active-selection, and edit-mode behaviors,
  plus regression coverage showing Digest and mobile Sheet behavior is
  unchanged.
- [x] 2.2 Own Report picker visibility in `InboxShell`, conditionally lay out
  the desktop Report rail, and add accessible shadcn Button controls for Hide
  reports and Show reports that remain reachable with a selected item or the
  Reports empty pane.

## 3. Report selection cards

- [x] 3.1 Add component coverage for Report card spacing and semantic surface,
  hover, focus, and selected treatments; verify every card exposes ID, title,
  and slug as one native detail-route link and Digest entries retain row
  styling.
- [x] 3.2 Restyle Report entries in the desktop rail and mobile list Sheet with
  the compact tmux-session-card rhythm using shadcn semantic tokens, while
  preserving list scrolling, truncation, native links, and active Report
  selection.

## 4. Report frontmatter timestamps

- [x] 4.1 Add focused frontmatter-panel coverage for valid quoted and unquoted
  Report timestamps, browser-local long formatting and ISO hover text, invalid
  and empty fallbacks, non-time Report fields, and unchanged Digest values.
- [x] 4.2 Pass artifact-kind context into the frontmatter property panel and
  reuse `TimestampLocal` for Report `created_at` / `updated_at` rows, including
  safe normalization of YAML `Date` values and scalar fallback for invalid
  timestamps.

## 5. Verification

- [x] 5.1 Run focused inbox-shell, frontmatter-panel, and related
  Markdown/Report embed component tests, then run the web typecheck.
- [x] 5.2 Inspect the Report page at desktop and mobile widths in light and dark
  themes, including a short Report, a long Report, human-readable local
  frontmatter timestamps, hidden/restored picker, keyboard focus, editing, and
  the mobile picker Sheet.
- [x] 5.3 Strictly validate the completed OpenSpec change.
