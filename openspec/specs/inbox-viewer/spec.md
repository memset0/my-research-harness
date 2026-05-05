# inbox-viewer Specification

## Purpose
TBD - created by archiving change inbox-reports-and-digests. Update Purpose after archive.
## Requirements
### Requirement: Desktop inbox layout (≥ md breakpoint)

The dashboard SHALL provide an inbox-shaped layout for browsing per-project markdown artifact families. On viewports at the `md` breakpoint or wider, the layout SHALL render two columns by default: a left rail (~280–320 px) holding a scrollable list of items, and a right pane (flex) holding the rendered markdown of the currently selected item. The active item in the rail SHALL be visually highlighted. When the user clicks Edit, the layout SHALL transition to three columns: list, rendered markdown, Monaco editor. Closing the editor (Save or Cancel) SHALL return to the two-column read mode.

#### Scenario: Two-column read mode default
- **WHEN** the user opens an inbox URL at desktop width
- **THEN** the layout renders the left rail (file list) and the right pane (rendered markdown of the selected item, or empty-state if none selected)
- **AND** no Monaco editor is mounted

#### Scenario: Switch to three-column edit mode
- **WHEN** the user clicks the Edit button in the right pane's header
- **THEN** the layout adds a Monaco editor pane (~440 px) to the right of the rendered markdown, and the rendered markdown stays visible as a live preview
- **AND** the editor mounts with the current file's content as its initial value

#### Scenario: Return to read mode on save
- **WHEN** the user clicks Save in the editor and the write succeeds
- **THEN** the editor pane unmounts, the layout returns to two columns, and the rendered markdown updates to reflect the saved content

### Requirement: Mobile inbox layout (< md breakpoint)

On viewports narrower than the `md` breakpoint, the layout SHALL render a single column showing the rendered markdown of the currently selected item (or an empty-state when none is selected). A floating action button (FAB) SHALL be anchored at `bottom-right` and SHALL be visible only on mobile (`md:hidden`). Tapping the FAB SHALL open a Sheet drawer from the right edge containing the same scrollable item list. Selecting an item from the drawer SHALL navigate to that item's URL and close the drawer.

#### Scenario: Mobile default view
- **WHEN** the user opens an inbox URL at viewport width < md
- **THEN** the layout shows only the rendered markdown of the currently selected item, with a FAB at bottom-right
- **AND** no list rail is visible

#### Scenario: FAB opens drawer
- **WHEN** the user taps the FAB
- **THEN** a Sheet slides in from the right showing the item list
- **AND** the rendered markdown remains in the background (faded by the Sheet's overlay)

#### Scenario: Drawer selection navigates and closes
- **WHEN** the user taps an item inside the drawer
- **THEN** the URL navigates to that item's detail route, the drawer closes, and the main content updates

### Requirement: Mobile edit mode is full-viewport

On mobile, tapping Edit SHALL open the Monaco editor in a full-viewport Sheet (`side="bottom"`, `h-[100svh]`) that covers the AppBar and the inbox layout below. The editor SHALL include a sticky toolbar with Save and Cancel buttons. Saving (success path) SHALL close the editor and refresh the rendered view; Cancel SHALL discard local edits and close.

#### Scenario: Mobile edit takeover
- **WHEN** the user taps Edit on mobile
- **THEN** a Sheet slides up from the bottom and covers the entire viewport including the AppBar
- **AND** Monaco is mounted inside the sheet with the current content

#### Scenario: Mobile save closes editor
- **WHEN** the user taps Save and the write succeeds
- **THEN** the sheet closes and the underlying rendered view shows the saved content

#### Scenario: Mobile cancel discards edits
- **WHEN** the user taps Cancel
- **THEN** the sheet closes immediately without writing; any unsaved typing is lost (no auto-save)

### Requirement: Optimistic locking on save

The editor SHALL submit writes with `expectedMtime` and `expectedHash` (sha1 of the content as last fetched). On a 409 CONFLICT response the UI SHALL show a toast indicating the on-disk content has changed since the editor opened, with a "Reload" action that re-fetches and re-mounts the editor with the fresh content. The user SHALL NOT silently overwrite a divergent on-disk version.

#### Scenario: Save under concurrent external write
- **GIVEN** the user has the editor open with the on-disk content as it was 30 seconds ago
- **WHEN** an external process (a skill, a `code` edit) writes the file in between, then the user clicks Save
- **THEN** the API returns 409 CONFLICT with the current on-disk mtime, hash, and content
- **AND** the UI shows a toast "External edit detected; click Reload to see the new content"
- **AND** the editor stays open with the user's unsaved typing intact until they click Reload

#### Scenario: Successful save updates the rendered view
- **WHEN** the user clicks Save and the API returns 200 with new mtime+hash
- **THEN** the editor closes and the rendered markdown view reflects the new content immediately (no second fetch needed)

### Requirement: Live updates from external writes

The inbox SHALL react to file additions, deletions, and content edits performed outside the dashboard (by a skill writing a new digest, or `code` editing a report) without a full-page reload. The trigger SHALL be the same SSE invalidation channel the existing Poller uses for experiments / journal / hypotheses, extended with `reports` and `digests` event kinds.

#### Scenario: New file appears in the rail
- **WHEN** a skill writes a new file matching the kind's filename pattern to the watched directory
- **THEN** within the polling backoff window, an SSE event fires and the rail re-renders with the new entry
- **AND** the user does not need to refresh

#### Scenario: External edit refreshes rendered view
- **WHEN** an external process edits the currently-selected file
- **THEN** the rendered markdown view updates to reflect the new content (assuming no editor is open; if the editor is open the user receives the conflict toast on save instead)

### Requirement: Empty state copy is kind-specific

When the watched directory is empty (no matching files yet), the inbox SHALL render an empty-state message tailored to the kind:
- For Reports: "No reports yet. Reports are written by `memon-write-report`; pick a hypothesis or set of experiments and ask the skill to summarize."
- For Digests: "No digests yet. Digests are written by `memon-digest-journal` and snapshot a date range from JOURNAL.md."

The kind-specific copy SHALL come from a prop on the shared layout component, not hardcoded inside it.

#### Scenario: Empty reports directory
- **WHEN** a project has no files matching `R<NNNN>-<slug>.md`
- **THEN** the right pane shows the Reports empty-state copy referencing `memon-write-report`
- **AND** the rail shows a small "no reports" placeholder

#### Scenario: Empty digests directory
- **WHEN** a project has no files matching `D<NNNN>-<YYYY-MM-DD>.md`
- **THEN** the right pane shows the Digests empty-state copy referencing `memon-digest-journal`

### Requirement: Frontmatter property panel above rendered body

When the currently-selected report or digest content begins with a YAML frontmatter block (a `---\n` opening fence followed by a `\n---` closing fence at the start of the file), the right pane SHALL split the content into (a) frontmatter and (b) body, and SHALL render the frontmatter as a Notion-style property panel above the rendered markdown body. The literal `---` fences SHALL NOT appear in the rendered output, and the keys/values inside the frontmatter SHALL NOT be passed to the markdown renderer.

The property panel SHALL render as a 2-column key/value grid:
- The label cell SHALL display the YAML key (lowercase, monospace, muted color) with stable left-aligned width across rows.
- The value cell SHALL display the parsed value with type-aware formatting: arrays as inline badge chips (one badge per element), strings/numbers/booleans as plain monospace text, and `null`/empty values as a dim em-dash placeholder.

When the file has NO leading frontmatter block, the panel SHALL be omitted and the body SHALL render as today (without spurious `---` artifacts, since none are present in the source).

When the leading `---\n…\n---` block fails to parse as YAML, the renderer SHALL fall back to passing the entire original content (including fences) to the markdown renderer; no panel is shown.

#### Scenario: Report with frontmatter renders panel and clean body
- **GIVEN** a report whose content starts with `---\nhypothesis: H0001\nstatus: CONFIRMED\nexperiments: [foo-260503-082800, bar-260504-091500]\n---\n# Findings\n…`
- **WHEN** the user selects that report
- **THEN** the right pane renders a property panel with rows `hypothesis: H0001`, `status: CONFIRMED`, `experiments: <two badges>`, followed below by the rendered markdown body starting at `# Findings`
- **AND** no `---` characters or raw frontmatter text are visible in the rendered surface

#### Scenario: Digest without frontmatter renders body only
- **GIVEN** a digest whose content begins directly with `# 2026-05-03`
- **WHEN** the user selects that digest
- **THEN** the right pane renders only the markdown body, with no property panel above it

#### Scenario: Malformed frontmatter falls back gracefully
- **GIVEN** a report whose content starts with `---\nbroken: [unbalanced\n---\nbody…`
- **WHEN** the user selects that report
- **THEN** the right pane shows no panel and renders the full original content via the markdown renderer (the user can still read the body and open the editor to fix the frontmatter)

#### Scenario: Editor still operates on the full file
- **WHEN** the user clicks Edit on a report with frontmatter
- **THEN** the Monaco buffer is initialised with the complete on-disk content INCLUDING the `---` fences and frontmatter keys (the panel is a render-side concern, not a storage transformation)

### Requirement: Inline code in inbox markdown is a chip, not styled prose

The shared markdown renderer used by the inbox panes SHALL render inline `<code>` elements as a visually distinct chip:

1. NO literal backtick characters around the element. When the source contains `` `foo` ``, the rendered output SHALL display only `foo` in the monospace face, with no surrounding `` ` `` characters injected by the typography styles.
2. Chip presentation: muted background fill, rounded corners, slight horizontal padding, and a font-size and weight that does NOT exceed the surrounding body text. Concretely the styling derives from the semantic `--muted` and `--foreground` tokens; values are at the component's discretion.

The chip styling SHALL apply ONLY to inline `<code>`. Code rendered inside fenced blocks (`<pre><code>…</code></pre>`) SHALL keep its `<pre>`-level appearance — transparent inner `<code>` background, zero inner padding, no rounded corners on the inner `<code>`, font-size/color inherited from the `<pre>`. Block code SHALL NOT receive the chip background, padding, or rounded corners.

#### Scenario: Inline code in a report body
- **GIVEN** a report body containing the text `` Run `memon scan` to refresh. ``
- **WHEN** the right pane renders the body
- **THEN** the word `memon scan` appears in the monospace face with NO backtick characters before or after it
- **AND** the `<code>` element has a muted background fill and rounded corners (chip presentation)

#### Scenario: Inline code in the empty-state copy
- **WHEN** the inbox empty-state renders `memon-write-report` from the empty-state markdown copy
- **THEN** `memon-write-report` appears in the monospace face with NO backtick characters around it
- **AND** the rendered chip is visually distinct from the surrounding body text via background fill

#### Scenario: Fenced code block keeps pre-level styling
- **GIVEN** a markdown body containing a fenced block with three or more lines of code
- **WHEN** the right pane renders the body
- **THEN** the inner `<code>` element inside the `<pre>` has a transparent background, zero padding, and no border-radius — the visible block styling comes from the surrounding `<pre>`
- **AND** the chip's muted background does NOT appear on either the `<code>` or the `<pre>`

