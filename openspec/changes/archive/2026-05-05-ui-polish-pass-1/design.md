## Context

The shared markdown surface in the web dashboard relies on `react-markdown` + `remark-gfm` rendered inside a Tailwind Typography (`prose`) container. `prose` injects `\`` characters around `<code>` via `::before`/`::after` pseudo-content; when combined with the monospace font swap this reads as a doubled backtick to the user.

Reports and digests are stored as plain markdown files with optional YAML frontmatter. The current pane pipes the raw file `content` straight into `<Markdown>`, so the leading `---` fences render as horizontal rules and the YAML body collapses into a single paragraph that looks like garbage.

The experiment list grid was originally laid out as `status | id | created | updated` with the sub-project badge inlined next to the id. The product preference is to (a) inline `Status` next to the id (the badge IS metadata about the id, not a separate scanning column) and (b) hoist sub-project into its own scanning column so cross-project filtering by eye is easier.

Constraints carried from CLAUDE.md / repo norms:
- `<Markdown>` is a client component; helpers it imports MUST stay client-safe (no `fs`, no `path`, no Node-only deps).
- Don't fork shadcn primitives — extend the typography styles via Tailwind utility classes on the wrapper, not by editing `globals.css` typography rules.
- shadcn-installed components only; for the property panel use existing `Badge`, plain `<dl>` + Tailwind grid.

## Goals / Non-Goals

**Goals:**
- Inline `<code>` shows no literal backtick characters anywhere `<Markdown>` is mounted.
- Experiment list row: status pill flows inline after the id; sub-project gets its own column.
- Reports/digests rendered pane shows a Notion-style property panel sourced from the file's YAML frontmatter, with the markdown body below it (sans frontmatter fences).

**Non-Goals:**
- No change to on-disk file format, parsing rules in `@memon/core`, or the API.
- No redesign of the experiment-detail front-matter panel — only the inbox pane gets a new panel; the experiment-detail panel already exists and stays as-is.
- No edit-side change. The Monaco editor still operates on the full raw content (frontmatter included).

## Decisions

### D1. Fix backticks via wrapper class, not by overriding `globals.css`
Add `prose-code:before:content-none prose-code:after:content-none` to the `<Markdown>` wrapper className. This stays inside `tailwind-merge`-friendly utility space and can be overridden by callers via the `className` prop. Alternative considered: redefine the typography theme in `globals.css` — rejected because it would diverge from the canonical shadcn / typography output and is harder to maintain.

### D2. Parse YAML frontmatter on the client with `js-yaml`
`@memon/core` has the canonical parser but it's tied to Node FS APIs. The inbox content is fetched as a single `content: string`, so we slice the leading `---\n…\n---` block with a regex and parse the YAML payload with `js-yaml` (browser-safe, ~16kB gzipped). Add `js-yaml` to `apps/web` deps.

Alternatives considered:
- Hand-roll a flat KV parser → rejected because frontmatter values include arrays (e.g. `hypotheses: [H0001]`) and we'd reinvent YAML.
- Move parsing to the server and ship parsed JSON in the API → rejected; would balloon scope into API/spec changes for a UX-only fix and risks divergence with the editor's view of "the same" file.

The splitter only matches frontmatter when the file STARTS with `---\n`. Files without frontmatter pass through untouched.

### D3. Property panel as a `<dl>` grid, not a table
Renders as a 2-column grid: label cell (`text-muted-foreground` uppercase tracking, ~6rem fixed) and value cell. Arrays render as inline `Badge` chips; primitives as `<span class="font-mono">`. Empty/null values render as a dim em-dash. Mirrors the visual language of `experiment-detail.tsx`'s front-matter panel without coupling to it (different shape: reports/digests have fewer canonical fields).

### D4. Experiment list grid: 12-col stays, columns rebalance
New column allocation on `md+`:
- `id + status pill` → `col-span-5`
- `sub-project` → `col-span-2` (renders empty cell when not applicable, so columns stay aligned)
- `created` → `col-span-2`
- `updated` → `col-span-3`

Header row mirrors the body row. The sub-project column reserves space even when empty so the grid keeps tabular alignment instead of jiggling between rows.

The `web-dashboard` spec scenario "Status emoji is the leftmost cell" needs a delta — after this change, the leftmost cell is the id (with status pill inline immediately after).

## Risks / Trade-offs

- [Risk] `js-yaml` parse on every render of a selected report/digest. → Mitigation: cheap (tens of ms for sub-1kB frontmatter), and `useMemo` keyed on `data.content` keeps it once per content change.
- [Risk] Reserving a sub-project column even when empty trades horizontal density for visual stability. → Mitigation: the column is only 2/12 ≈ 16% width; the trade is worth the alignment.
- [Risk] Some existing reports may have malformed YAML frontmatter (e.g. unbalanced fences). → Mitigation: parser falls back to "no panel, render full content" on any parse error; user still sees the body intact and can edit to fix.
- [Risk] The prose-code utility classes need `@tailwindcss/typography` already configured (it is — see `apps/web/package.json`). → No mitigation needed; verified.
