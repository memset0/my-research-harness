## Why

Three rendering issues showed up while using the dashboard and degrade trust in the UI:

1. The shared `<Markdown>` renderer wraps inline `<code>` with literal backtick characters via Tailwind Typography's default `prose code::before/::after` content, so `` `foo` `` reads as `` `foo` `` on the page even though the font already changed.
2. The experiment list splits `Status` into its own grid column while inlining the sub-project badge next to the id, which fights the visual grouping a reader expects (status belongs WITH the id, sub-project is a property worth its own column for scanning).
3. Reports and digests render their full file contents through `<Markdown>`, including the leading YAML frontmatter, which then surfaces as stray `---` thematic breaks and a malformed key/value blob. Frontmatter SHOULD render as a Notion-style property panel above the rendered body.

## What Changes

- Update the shared `<Markdown>` component to suppress the prose-injected backtick pseudo-content on inline `<code>` (`prose-code:before:content-none prose-code:after:content-none`) — fixes (1) everywhere the component is used (reports, digests, experiment detail, inbox empty-state).
- Restructure the experiment list row: `Status` no longer occupies its own grid column; the `<StatusPill>` renders inline immediately after the experiment id within the same cell. The sub-project badge moves into a new dedicated grid column (only rendered when `frontMatter.project` is non-empty AND distinct from the membership project — same predicate as today).
- Introduce a frontmatter property panel for reports/digests:
  - Strip the leading YAML frontmatter (`---\n…\n---`) from the raw content before passing the body to `<Markdown>`.
  - Render the parsed frontmatter as a structured key/value panel above the rendered body. Visual style mirrors the existing experiment-detail front-matter panel (label column + value column, monospace where appropriate). Each row is `key: value`; arrays render as space-separated badges; nulls/empty render dim.
  - When the file has no frontmatter, the panel is omitted (the body renders as today, only without the literal `---` artifacts).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-dashboard`: experiment-list row layout (status no longer a column; sub-project promoted to its own column).
- `inbox-viewer`: rendered pane SHALL split frontmatter from body and render the frontmatter as a property panel; inline-code in any inbox markdown SHALL NOT show literal backticks.

## Impact

- Code:
  - `apps/web/components/markdown.tsx` (CSS class additions; no API change)
  - `apps/web/components/experiment-list.tsx` (grid column shape, header row, row body)
  - `apps/web/components/inbox-shell.tsx` (`SelectedItemPane` adds a frontmatter panel; uses a small splitter helper)
  - New helper `apps/web/lib/frontmatter.ts` (regex split + js-yaml parse, client-safe)
  - `apps/web/package.json` adds `js-yaml` (and `@types/js-yaml` dev dep)
- Spec deltas: `web-dashboard`, `inbox-viewer` only. No backend / API / on-disk change.
- Verification per CLAUDE.md: typecheck, curl the served HTML for the new markup (panel labels, sub-project column header), and curl the compiled CSS to confirm the typography overrides land in the bundle.
