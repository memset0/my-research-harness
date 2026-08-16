# inbox-viewer Specification

## Purpose
TBD - created by archiving change inbox-reports-and-digests. Update Purpose after archive.
## Requirements
### Requirement: Desktop inbox layout (≥ md breakpoint)

The dashboard SHALL provide an inbox-shaped layout for browsing per-project
markdown artifact families. On viewports at the `md` breakpoint or wider, the
layout SHALL render two columns by default: a left rail (~280–320 px) holding a
scrollable list of items, and a right pane (flex) holding the rendered markdown
of the currently selected item. The active item in the rail SHALL be visually
highlighted.

On Report routes, the desktop rail SHALL include an accessible control that
lets the user hide it. Hiding the rail SHALL remove it from the layout and let
the right pane reclaim the available width. A corresponding accessible control
SHALL remain visible in the right pane so the user can show the rail again. The
rail SHALL be shown by default when the Report inbox mounts. Digest routes SHALL
retain their always-visible desktop rail.

When the user clicks Edit, the layout SHALL add a Monaco editor to the right of
the rendered markdown. This produces three columns when the list rail is shown
and two columns when a Report user has hidden the list rail. Closing the editor
(Save or Cancel) SHALL preserve the current Report rail visibility and remove
the editor.

#### Scenario: Two-column read mode default

- **WHEN** the user opens an inbox URL at desktop width
- **THEN** the layout renders the left rail (file list) and the right pane
  (rendered markdown of the selected item, or empty-state if none selected)
- **AND** no Monaco editor is mounted

#### Scenario: Report picker can be hidden and restored

- **GIVEN** the user opens a Report detail route at desktop width
- **WHEN** the user activates the Hide reports control
- **THEN** the Report rail is removed and the rendered Report pane expands into
  the reclaimed width
- **AND** a Show reports control remains visible and keyboard accessible
- **WHEN** the user activates Show reports
- **THEN** the Report rail returns with the same active Report selected

#### Scenario: Digest rail remains always visible

- **WHEN** the user opens a Digest detail route at desktop width
- **THEN** the left Digest rail is visible
- **AND** Report-specific Hide reports and Show reports controls are absent

#### Scenario: Switch to three-column edit mode

- **GIVEN** the user is reading a Report at desktop width
- **WHEN** the user clicks the Edit button in the right pane's header
- **THEN** the layout adds a Monaco editor pane (~440 px) to the right of the
  rendered markdown, and the rendered markdown stays visible as a live preview
- **AND** the editor mounts with the current file's content as its initial value
- **AND** the layout has three columns when the Report rail is shown and two
  columns when it is hidden

#### Scenario: Return to read mode on save

- **WHEN** the user clicks Save in the editor and the write succeeds
- **THEN** the editor pane unmounts and the rendered markdown updates to reflect
  the saved content
- **AND** a Report rail returns to its pre-edit shown or hidden state

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

### Requirement: Rendered Report body uses a distinct document surface

The scrollable body area containing a selected Report's frontmatter properties
and rendered Markdown SHALL use the semantic card background rather than
inheriting the page background. In the light theme this surface SHALL resolve to
pure white and remain visually distinct from the tinted application background;
in the dark theme it SHALL use the theme's card color instead of forcing a light
color. The document background SHALL cover the available reading pane below its
toolbar, including space beyond short Report content.

This treatment SHALL be scoped to selected Reports. Digest reading surfaces and
Report/Digest empty, loading, and error states SHALL retain their existing
background behavior.

#### Scenario: Report body is white in the light theme

- **GIVEN** the dashboard is using its light theme
- **WHEN** the user opens `/p/<project>/reports/<id>` and the Report loads
- **THEN** the entire Report reading surface below the toolbar uses the semantic
  card background, which resolves to pure white
- **AND** both the frontmatter property panel and Markdown body appear on that
  surface

#### Scenario: Report body remains theme-aware in the dark theme

- **GIVEN** the dashboard is using its dark theme
- **WHEN** the user opens a Report detail route
- **THEN** the Report reading surface uses the dark card token
- **AND** no hard-coded white surface is introduced

#### Scenario: Digest body is unchanged

- **WHEN** the user opens `/p/<project>/digests/<id>`
- **THEN** its rendered body keeps the existing inbox background treatment

### Requirement: Report picker entries use compact selectable cards

Each Report entry in the desktop rail and mobile Report-list Sheet SHALL render
as one compact card-like link. The list SHALL use consistent inset padding and
spacing between cards instead of full-width divider rows. Each card SHALL use
shadcn semantic surface, border, accent, foreground, and focus-ring tokens and
SHALL expose the Report ID, title, and slug with a clear information hierarchy.

The entire card SHALL be a native link to the Report detail route. Hover SHALL
provide a subtle accent treatment, keyboard focus SHALL have a visible focus
ring, and the selected Report SHALL have a primary-border (or equivalently
prominent semantic) active treatment. These states SHALL follow the compact
card rhythm used by the tmux management session list without copying tmux-only
actions or metadata.

Digest picker entries SHALL keep their existing row presentation.

#### Scenario: Report entries render as spaced cards

- **GIVEN** a project has multiple Reports
- **WHEN** the Report picker renders on desktop or in the mobile Sheet
- **THEN** each Report appears as a separate rounded, bordered semantic card
  with visible space between adjacent entries
- **AND** each card displays its Report ID, title, and slug

#### Scenario: Whole Report card navigates

- **WHEN** the user activates any non-action area of a Report card with pointer,
  Enter, or the browser's native link activation
- **THEN** navigation targets that Report's existing detail URL
- **AND** the interaction retains native-link semantics

#### Scenario: Active, hover, and focus states are distinguishable

- **GIVEN** one Report is currently selected
- **WHEN** the Report picker is visible
- **THEN** the selected card has a prominent semantic active border
- **AND** an unselected card receives a subtle accent treatment on hover
- **AND** keyboard focus is visibly indicated by the standard focus ring

#### Scenario: Digest entries retain row styling

- **WHEN** the Digest picker renders
- **THEN** its entries keep the existing divider-row presentation rather than
  adopting the Report card treatment

### Requirement: Report frontmatter timestamps are human-readable

When a selected Report's frontmatter contains the canonical `created_at` or
`updated_at` key with a valid ISO 8601 timestamp, the property panel SHALL
display that value as a human-readable date and time in the browser's current
locale and time zone. This behavior SHALL support timestamps represented as
YAML strings and timestamps parsed by the YAML loader as date values.

The formatted value SHALL expose the source ISO timestamp, or its normalized ISO
equivalent for a parsed date value, as secondary hover information. An invalid
timestamp SHALL fall back to the existing scalar presentation, and an empty
value SHALL retain the existing em-dash placeholder. Other Report frontmatter
keys and all Digest frontmatter values SHALL retain their existing formatting.

#### Scenario: Valid Report timestamps use local date-time formatting

- **GIVEN** a Report has valid ISO 8601 `created_at` and `updated_at` values
- **WHEN** its frontmatter property panel renders in the browser
- **THEN** both values display as full human-readable local date-times rather
  than raw ISO 8601 text
- **AND** each formatted value exposes its ISO timestamp as hover information

#### Scenario: Unquoted YAML timestamp is supported

- **GIVEN** a Report's unquoted `created_at` timestamp is parsed as a date value
- **WHEN** the frontmatter property panel renders
- **THEN** the value is normalized and displayed as a human-readable local
  date-time without being serialized as a generic object

#### Scenario: Invalid and empty timestamps fall back safely

- **GIVEN** a Report has an invalid `created_at` scalar and an empty
  `updated_at`
- **WHEN** the frontmatter property panel renders
- **THEN** the invalid scalar remains visible unchanged
- **AND** the empty value renders the existing em-dash placeholder

#### Scenario: Non-time and Digest frontmatter formatting is unchanged

- **WHEN** the property panel renders another Report key or any Digest
  frontmatter key
- **THEN** strings, numbers, booleans, arrays, objects, and timestamp-looking
  values keep their existing formatting behavior

### Requirement: Report picker visibility persists across visits

The shown/hidden state of the desktop Report picker SHALL be a user preference
shared across Report inbox routes and projects. With no saved preference, the
picker SHALL default to shown. When a user hides or shows the picker, the UI
SHALL update immediately and the chosen state SHALL be restored after switching
Reports, switching projects, remounting the inbox, or reloading the page.

The preference SHALL use the dashboard's browser-first preference behavior. For
an authenticated owner, a stored server preference SHALL reconcile through the
existing owner-keyed UI-preferences store. Viewer and anonymous sessions SHALL
remain browser-local and SHALL NOT read or write owner preference storage.

This preference SHALL control only the desktop Report rail. The mobile
Report-list Sheet and all Digest rails SHALL retain their existing behavior.

#### Scenario: First visit defaults to shown

- **GIVEN** no Report picker preference exists in browser or owner storage
- **WHEN** the user opens a Report inbox route at desktop width
- **THEN** the Report picker is shown

#### Scenario: Hidden preference survives Report navigation and reload

- **GIVEN** the user hides the desktop Report picker
- **WHEN** the user switches to another Report or reloads the Report route
- **THEN** the desktop Report picker remains hidden
- **AND** its Show reports control remains available

#### Scenario: Restored picker state is saved immediately in the browser

- **GIVEN** the saved Report picker preference is hidden
- **WHEN** the user activates Show reports
- **THEN** the picker appears without waiting for a server request
- **AND** a subsequent inbox mount restores the shown state

#### Scenario: Invalid stored value falls back safely

- **GIVEN** browser or owner preference storage contains a non-boolean Report
  picker value
- **WHEN** the Report inbox resolves that preference
- **THEN** the picker uses the default shown state
- **AND** the invalid value does not create an indeterminate layout

#### Scenario: Owner preference reconciles across browsers

- **GIVEN** an authenticated owner's server preference records the Report
  picker as hidden
- **WHEN** the owner opens a Report route in a browser with no preference or a
  conflicting shown preference
- **THEN** the server value becomes authoritative and the picker resolves to
  hidden

#### Scenario: Viewer preference remains browser-local

- **GIVEN** a viewer or anonymous session changes the Report picker preference
- **WHEN** the preference is saved
- **THEN** only browser storage is updated
- **AND** no owner UI-preference row is read or written

#### Scenario: Mobile and Digest navigation are unaffected

- **GIVEN** the persisted desktop Report picker preference is hidden
- **WHEN** the user opens the Report inbox below the desktop breakpoint or opens
  a Digest inbox
- **THEN** the mobile Report-list Sheet remains available
- **AND** the Digest desktop rail remains visible

### Requirement: Collapsed Report identity opens a quick switcher

When a selected Report is displayed at desktop width and the Report picker is
hidden, the toolbar's current Report identity SHALL combine the Report ID and
slug into an accessible quick-switch trigger, for example `R0001
fastvideo-fa4-nvfp4-inference`. Activating it SHALL open a shadcn-styled Popover
containing a compact, vertically scrollable list of the current project's
Reports.

Each Popover item SHALL be a native link to the existing Report detail route,
SHALL expose its ID, slug, and title, and SHALL use a distinct selected treatment
plus `aria-current="page"` for the current Report. Selecting another Report SHALL
close the Popover and navigate while leaving the persisted picker state hidden.
The Popover SHALL support keyboard activation, visible focus, Escape/outside
dismissal, and focus return to its trigger.

While the Report list query is still pending, the Popover SHALL show the same
list loading treatment as the full rail rather than an incorrect empty-list
message.

When the desktop picker is shown, the Report identity SHALL remain ordinary
toolbar metadata and SHALL NOT open a duplicate quick switcher. On mobile, the
identity SHALL remain non-interactive and the existing Report-list Sheet SHALL
remain the switching surface. Digest toolbars SHALL NOT gain this trigger.

#### Scenario: Collapsed identity opens the Report list

- **GIVEN** the desktop Report picker is hidden while `R0001
  fastvideo-fa4-nvfp4-inference` is selected
- **WHEN** the user activates the current Report identity
- **THEN** a Popover opens with the project's available Reports
- **AND** `R0001` is marked as the current native link

#### Scenario: Quick switch navigates without expanding the rail

- **GIVEN** the quick-switch Popover is open and another Report `R0002` is
  available
- **WHEN** the user activates the `R0002` link
- **THEN** the Popover closes and navigation targets the existing `R0002`
  detail URL
- **AND** the persisted desktop Report picker preference remains hidden

#### Scenario: Long Report lists scroll inside the Popover

- **GIVEN** the project has more Reports than fit in the Popover's bounded
  viewport height
- **WHEN** the quick switcher opens
- **THEN** the list scrolls vertically inside the Popover
- **AND** the surrounding Report document does not need to scroll to reach every
  option

#### Scenario: Keyboard dismissal returns focus

- **GIVEN** the quick-switch Popover was opened from the current Report identity
- **WHEN** the user presses Escape
- **THEN** the Popover closes
- **AND** keyboard focus returns to the identity trigger

#### Scenario: Expanded, mobile, and Digest identities stay non-interactive

- **WHEN** the Report rail is expanded, the Report page is below the desktop
  breakpoint, or a Digest is selected
- **THEN** the current artifact identity does not expose the Report
  quick-switch trigger
- **AND** the existing desktop rail or mobile Sheet remains the applicable
  switching mechanism

### Requirement: Report bodies begin with a generated table of contents

The full-page and side-pane Report reading surfaces SHALL generate an accessible table of contents from the Report Markdown's level-two through level-six headings. The table of contents SHALL appear after any frontmatter presentation and before the rendered Markdown body, SHALL omit the document-level H1 title, and SHALL not render when the body has no eligible section headings.

Each directory entry SHALL link to the matching rendered heading. Heading IDs SHALL be stable for the same content, scoped with a Report-specific prefix so they do not collide with the left document, preserve readable Unicode heading text, and disambiguate repeated heading labels deterministically. Visual indentation SHALL reflect the source heading depth.

Digest bodies and Markdown surfaces outside Report rendering SHALL retain their existing behavior without a generated table of contents.

#### Scenario: Full Report exposes linked sections
- **GIVEN** a full-page Report body contains an H1 title, two H2 sections, and an H3 subsection
- **WHEN** the Report is rendered
- **THEN** a table-of-contents navigation region appears before the H1 title
- **AND** it contains links for the two H2 sections and H3 subsection but not the H1 title
- **AND** each link targets the matching heading ID

#### Scenario: Side Report uses the same outline
- **GIVEN** a Report is open in the right-side split or drawer
- **WHEN** its Markdown body is rendered
- **THEN** the same generated table of contents appears at the start of that Report body
- **AND** its Report-prefixed targets do not collide with headings in the left document

#### Scenario: Duplicate and Unicode headings remain addressable
- **GIVEN** a Report contains repeated section labels and section labels with Unicode characters
- **WHEN** its table of contents is generated
- **THEN** repeated labels receive distinct deterministic target IDs
- **AND** Unicode labels remain readable in the directory and target anchors

#### Scenario: Empty outlines and Digests remain absent
- **WHEN** a Report contains only its H1 title, or a Digest contains section headings
- **THEN** no generated Report table of contents is rendered for that body

