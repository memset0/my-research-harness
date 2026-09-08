# wiki-viewer Specification

## Purpose
Defines how the dashboard presents a project's wiki beside the existing Report surfaces: the `Wiki` AppBar entry and its routes, the kind-grouped page rail with status, staleness, and review signals, the reading and editing surface for one page, the owner-only review action, the Experiment backlink list, and the desktop/mobile behaviour of all of them.

## Requirements

### Requirement: Wiki routes and AppBar entry

The dashboard SHALL expose the project's wiki at `/p/<project>/wiki` (landing, no page selected) and `/p/<project>/wiki/<W-id>` (one page selected), with Host-qualified central mirrors at `/h/<host>/p/<project>/wiki` and `/h/<host>/p/<project>/wiki/<W-id>`. The per-project AppBar SHALL render a `Wiki` tab immediately to the right of the `Code Review` tab (the last tab), carrying a count badge whose value is the number of wiki pages in the current project and which follows the existing badge loading-skeleton and SSE-invalidation behavior. The `Reports` tab and its routes SHALL remain available beside it.

An id that does not match `^W\d{4}$` SHALL render the standard not-found response for the route. A page id that matches the shape but is absent from the project SHALL render a recoverable not-found state inside the wiki surface with the rail and filter still usable.

#### Scenario: Wiki tab navigates to the landing route
- **WHEN** the user activates the `Wiki` tab from any per-project view
- **THEN** the URL becomes `/p/<project>/wiki` and the `Wiki` tab is in its active state
- **AND** the wiki surface renders with no page selected

#### Scenario: Tab badge counts pages
- **GIVEN** a project with 12 wiki pages
- **WHEN** the AppBar renders after the wiki list query resolves
- **THEN** the `Wiki` tab badge shows `12`
- **AND** it renders a skeleton placeholder while the query is still loading

#### Scenario: Central mirror keeps Host identity
- **WHEN** the user opens `/h/<host>/p/<project>/wiki/W0007` in central mode
- **THEN** the page renders from that configured Host-qualified project's central service
- **AND** every rail entry and detail action link retains the `/h/<host>/` prefix

#### Scenario: Unknown page id is recoverable
- **WHEN** the user opens `/p/<project>/wiki/W9999` and no such page exists
- **THEN** the reading pane shows a not-found state
- **AND** the rail and its filter remain available for choosing another page

### Requirement: Desktop wiki layout: page list, reading surface, outline

On viewports at the `md` breakpoint or wider, the wiki surface SHALL render three regions left to right: a left rail (~280–320 px) holding the scrollable page card list; a centre reading surface for the selected page (or the empty state); and a right outline column (~220–260 px) holding the selected page's table of contents, sticky while the body scrolls, hidden when the page has no eligible headings or nothing is selected. Document content SHALL be at most 720px wide. The reading document and its immediately adjacent outline SHALL be centered as one group within the space remaining after the rail; without an outline the document SHALL be centered alone. The active page in the rail SHALL be visually highlighted.

The desktop rail SHALL include an accessible control that hides it, letting the reading surface reclaim the width, and a corresponding accessible control SHALL remain visible in the reading surface to show it again. When the user activates Edit, the layout SHALL replace the outline column with a Monaco editor pane to the right of the rendered Markdown. Closing the editor through Save or Cancel SHALL restore the outline column and preserve the current rail visibility.

#### Scenario: Three-column read mode default
- **WHEN** a page is open on a desktop viewport
- **THEN** the page list, the rendered page, and its outline are visible side by side

#### Scenario: Hiding the rail
- **WHEN** the user activates the hide-rail control
- **THEN** the rail disappears, the reading surface widens, and a show-rail control is visible

#### Scenario: Edit replaces the outline
- **WHEN** the user activates Edit
- **THEN** the editor appears to the right of the rendered Markdown and the outline column is not shown
- **WHEN** the user saves or cancels
- **THEN** the outline column returns and the rail visibility is unchanged

### Requirement: Rail is a flat card list ordered by last edit

The page rail SHALL list every page of the project as one flat list ordered by `updatedAt` descending (deprecated pages last, in the same order among themselves), without kind grouping. A kind filter (single-select, including "all") and the text filter MAY narrow the list; the ordering SHALL not change.

#### Scenario: Newest first
- **GIVEN** `W0002` updated on 05-04 and `W0005` updated on 05-06
- **WHEN** the rail renders
- **THEN** `W0005` precedes `W0002` regardless of kind

#### Scenario: Deprecated last
- **GIVEN** `W0007` is deprecated and newer than `W0001`
- **WHEN** the rail renders
- **THEN** `W0001` precedes `W0007`

### Requirement: Rail entries use compact cards showing status, staleness, and review state

Each page entry in the desktop rail and in the mobile page Sheet SHALL render as one compact card-like link. The list SHALL use consistent inset padding and spacing between cards instead of full-width divider rows. Each card SHALL use shadcn semantic surface, border, accent, foreground, and focus-ring tokens and SHALL expose, in this hierarchy: a kind badge (the `kind` label), the page title, then — when present — its `description` as a secondary line clamped to two lines, and a muted meta line with its `W<NNNN>` id and relative last-edit time. A page whose kind defines a status vocabulary SHALL show that status as a badge; a page whose list projection reports `stale: true` SHALL show an accessible stale indicator distinguishable from the status badge and SHALL expose the offending `staleSources` as hover or accessible description text.

Each card SHALL additionally show the page's derived `review.state` as a review badge next to the status and stale signals, with a distinct visual treatment per value (`VERIFIED`, `CHANGED_SINCE_VERIFY`, `UNVERIFIED`) and an accessible label that names the state; a `REVIEWED` or `CHANGED_SINCE_REVIEW` badge SHALL expose `reviewedAt` as hover or accessible description text. The three axes SHALL stay individually readable: a card can carry a status badge, a stale indicator, and a review badge at once without truncating the title beyond its normal ellipsis.

The entire card SHALL be a native link to the page's detail route. Hover SHALL provide a subtle accent treatment, keyboard focus SHALL have a visible focus ring, and the selected page SHALL have a primary-border (or equivalently prominent semantic) active treatment.

#### Scenario: Entries render as spaced cards with metadata
- **GIVEN** a project has multiple wiki pages
- **WHEN** the rail renders on desktop or in the mobile Sheet
- **THEN** each page appears as a separate rounded, bordered semantic card with visible space between adjacent entries
- **AND** each card displays its title, `W<NNNN>` id, and slug

#### Scenario: Status and stale signals are distinguishable
- **GIVEN** `W0004` is a `finding` with `status: VERIFIED` and `stale: true`
- **WHEN** its card renders
- **THEN** the card shows a `VERIFIED` status badge and a separate stale indicator
- **AND** the stale indicator exposes the stale source ids as accessible text

#### Scenario: Review badge sits beside status and stale
- **GIVEN** `W0004` shows `status: VERIFIED` with `stale: true` and its body changed after the last verified wiki commit
- **WHEN** its card renders
- **THEN** the card shows a `CHANGED_SINCE_VERIFY` review badge alongside the status badge and the stale indicator
- **AND** a page none of whose lines are covered shows an `UNVERIFIED` review badge instead

#### Scenario: Whole card navigates
- **WHEN** the user activates any non-action area of a card with pointer, Enter, or native link activation
- **THEN** navigation targets that page's detail URL
- **AND** the interaction retains native-link semantics

#### Scenario: Active, hover, and focus states are distinguishable
- **GIVEN** one page is currently selected
- **WHEN** the rail is visible
- **THEN** the selected card has a prominent semantic active border
- **AND** an unselected card receives a subtle accent treatment on hover
- **AND** keyboard focus is visibly indicated by the standard focus ring

### Requirement: Rail exposes a text filter over title, slug, and tags

The rail SHALL provide a labelled text input that filters the visible pages case-insensitively by substring match against title, slug, and any `tags` entry. Filtering SHALL be client-side over the already-loaded list, SHALL keep matching pages grouped under their kind headers, SHALL hide groups with no match, and SHALL NOT navigate or change the selected page. A filter matching nothing SHALL show a "no matching pages" placeholder while leaving the input and its clear affordance usable. Clearing the input SHALL restore the full grouped list.

#### Scenario: Filter narrows the list
- **GIVEN** the project has pages titled `Weekly sync` and `Common-path debt` and a page tagged `kernel`
- **WHEN** the user types `kernel` into the filter
- **THEN** only pages whose title, slug, or tags contain `kernel` remain visible under their kind headers

#### Scenario: Filter does not change the selection
- **GIVEN** `W0007` is selected and does not match the current filter text
- **WHEN** the filter is applied
- **THEN** `W0007` remains rendered in the reading pane
- **AND** the URL is unchanged

#### Scenario: No match shows a placeholder
- **WHEN** the filter text matches no page
- **THEN** the rail shows a "no matching pages" placeholder
- **AND** clearing the filter restores every page

### Requirement: Wiki reading surface composes frontmatter, diagnostics, outline, and body

The reading surface for a selected page SHALL render, in order: a frontmatter property panel, the page's diagnostics, and the rendered Markdown body; the generated table of contents lives in the right outline column on desktop and above the body on narrower viewports. The frontmatter panel SHALL split the leading `---` fenced YAML block from the body, SHALL NOT render the literal fences, and SHALL present keys as a two-column key/value grid with the label cell in lowercase monospace muted text and type-aware value formatting (arrays as inline badge chips, scalars as monospace text, empty values as a dim em-dash). A page whose content has no leading frontmatter block SHALL omit the panel; a leading block that fails to parse as YAML SHALL fall back to passing the entire original content to the Markdown renderer with no panel.

Diagnostics reported for the page SHALL be surfaced adjacent to the frontmatter panel, grouped by severity, each showing its diagnostic code and message, with errors visually distinct from warnings. A page with no diagnostics SHALL show no diagnostics region.

#### Scenario: Page renders panel, diagnostics, outline, then body
- **GIVEN** page `W0004` has frontmatter, one `WIKI_MISSING_SECTION` warning, and a body with H2 sections
- **WHEN** the user selects it
- **THEN** the reading pane renders the property panel, then the warning with its code, then the generated table of contents, then the Markdown body
- **AND** no `---` characters or raw frontmatter text are visible in the rendered surface

#### Scenario: Errors are distinguishable from warnings
- **GIVEN** a page carrying `WIKI_STATUS_INVALID` (error) and `WIKI_SOURCE_UNRESOLVED` (warning)
- **WHEN** the page renders
- **THEN** both appear near the frontmatter panel with their codes
- **AND** the error uses a visually distinct severity treatment from the warning

#### Scenario: Malformed frontmatter falls back gracefully
- **GIVEN** a page whose content starts with `---\nbroken: [unbalanced\n---\nbody…`
- **WHEN** the user selects that page
- **THEN** the pane shows no panel and renders the full original content through the Markdown renderer
- **AND** the user can still open the editor to fix the frontmatter

#### Scenario: Editor operates on the full file
- **WHEN** the user activates Edit on a page with frontmatter
- **THEN** the Monaco buffer is initialised with the complete on-disk content including the `---` fences and frontmatter keys

### Requirement: Wiki frontmatter timestamps are human-readable

When a selected page's frontmatter contains `created_at`, `updated_at`, or `date` with a valid value, the property panel SHALL display it as a human-readable date and time (or date, for `date`) in the browser's current locale and time zone. This behavior SHALL support values represented as YAML strings and values parsed by the YAML loader as date values.

The formatted value SHALL expose the source ISO timestamp, or its normalized ISO equivalent for a parsed date value, as secondary hover information. An invalid value SHALL fall back to the existing scalar presentation, and an empty value SHALL retain the em-dash placeholder. Other frontmatter keys SHALL retain their existing formatting.

#### Scenario: Valid timestamps use local date-time formatting
- **GIVEN** a page has valid ISO 8601 `created_at` and `updated_at` values
- **WHEN** its frontmatter property panel renders in the browser
- **THEN** both values display as full human-readable local date-times rather than raw ISO 8601 text
- **AND** each formatted value exposes its ISO timestamp as hover information

#### Scenario: Meeting date renders as a date
- **GIVEN** a `meeting` page with `date: 2026-09-01` parsed by the YAML loader as a date value
- **WHEN** the panel renders
- **THEN** the value displays as a human-readable date without being serialized as a generic object

#### Scenario: Invalid and empty values fall back safely
- **GIVEN** a page has an invalid `created_at` scalar and an empty `updated_at`
- **WHEN** the panel renders
- **THEN** the invalid scalar remains visible unchanged
- **AND** the empty value renders the em-dash placeholder

### Requirement: Wiki bodies begin with a generated table of contents

The full-page and side-pane wiki reading surfaces SHALL generate an accessible table of contents from the page Markdown's level-two through level-six headings. On desktop the table of contents SHALL render in the sticky right outline column; on narrower viewports it SHALL appear after the frontmatter and diagnostics presentation and before the rendered Markdown body. It SHALL omit the document-level H1 title, and SHALL NOT render when the body has no eligible section headings.

Each directory entry SHALL link to the matching rendered heading. Heading IDs SHALL be stable for the same content, scoped with a wiki-specific prefix so they do not collide with the left document, preserve readable Unicode heading text, and disambiguate repeated heading labels deterministically. Visual indentation SHALL reflect the source heading depth.

#### Scenario: Full page exposes linked sections
- **GIVEN** a full-page wiki body contains an H1 title, two H2 sections, and an H3 subsection
- **WHEN** the page is rendered
- **THEN** a table-of-contents navigation region appears before the H1 title
- **AND** it contains links for the two H2 sections and the H3 subsection but not the H1 title
- **AND** each link targets the matching heading ID

#### Scenario: Side pane uses the same outline
- **GIVEN** a wiki page is open in the right-side split or drawer
- **WHEN** its Markdown body is rendered
- **THEN** the same generated table of contents appears at the start of that body
- **AND** its wiki-prefixed targets do not collide with headings in the left document

#### Scenario: Duplicate and Unicode headings remain addressable
- **GIVEN** a page contains repeated section labels and labels with Unicode characters
- **WHEN** its table of contents is generated
- **THEN** repeated labels receive distinct deterministic target IDs
- **AND** Unicode labels remain readable in the directory and target anchors

#### Scenario: Empty outline renders nothing
- **WHEN** a page contains only its H1 title
- **THEN** no generated table of contents is rendered for that body

### Requirement: Rendered wiki body uses a distinct document surface

The scrollable body area containing a selected page's frontmatter properties, diagnostics, and rendered Markdown SHALL use the semantic card background rather than inheriting the page background. In the light theme this surface SHALL resolve to pure white and remain visually distinct from the tinted application background; in the dark theme it SHALL use the theme's card color instead of forcing a light color. The document background SHALL cover the available reading pane below its toolbar, including space beyond short page content.

This treatment SHALL be scoped to selected pages. Wiki empty, loading, and error states SHALL retain the ordinary application background behavior.

The reading pane SHALL NOT produce a horizontal scrollbar at any of its vertical scroll layers; every layer that scrolls vertically SHALL pair `overflow-y-auto` with an explicit `overflow-x-hidden`. Internal horizontal scroll affordances on individual content elements, such as the `<pre>` produced by a fenced code block, SHALL be preserved.

#### Scenario: Page body is white in the light theme
- **GIVEN** the dashboard is using its light theme
- **WHEN** the user opens `/p/<project>/wiki/<id>` and the page loads
- **THEN** the entire reading surface below the toolbar uses the semantic card background, which resolves to pure white
- **AND** the frontmatter property panel and Markdown body appear on that surface

#### Scenario: Page body remains theme-aware in the dark theme
- **GIVEN** the dashboard is using its dark theme
- **WHEN** the user opens a wiki detail route
- **THEN** the reading surface uses the dark card token and no hard-coded white surface is introduced

#### Scenario: Wide content does not scroll the pane horizontally
- **GIVEN** a page whose body contains a fenced code block wider than the rendered area
- **WHEN** the page renders
- **THEN** the pane's vertical scroll layers carry `overflow-x-hidden` alongside `overflow-y-auto`
- **AND** the `<pre>` block keeps its own horizontal scrolling

### Requirement: Wiki picker visibility persists across visits

The shown/hidden state of the desktop page rail SHALL be a user preference shared across wiki routes and projects. With no saved preference, the rail SHALL default to shown. When a user hides or shows the rail, the UI SHALL update immediately and the chosen state SHALL be restored after switching pages, switching projects, remounting the wiki surface, or reloading the page.

The preference SHALL use the dashboard's browser-first preference behavior. For an authenticated owner, a stored server preference SHALL reconcile through the existing owner-keyed UI-preferences store. Viewer and anonymous sessions SHALL remain browser-local and SHALL NOT read or write owner preference storage. The preference SHALL control only the desktop rail; the mobile page Sheet SHALL remain available regardless.

#### Scenario: First visit defaults to shown
- **GIVEN** no wiki rail preference exists in browser or owner storage
- **WHEN** the user opens a wiki route at desktop width
- **THEN** the rail is shown

#### Scenario: Hidden preference survives navigation and reload
- **GIVEN** the user hides the desktop rail
- **WHEN** the user switches to another page or reloads the wiki route
- **THEN** the desktop rail remains hidden
- **AND** its show control remains available

#### Scenario: Restored state is saved immediately in the browser
- **GIVEN** the saved rail preference is hidden
- **WHEN** the user activates the show control
- **THEN** the rail appears without waiting for a server request
- **AND** a subsequent mount restores the shown state

#### Scenario: Invalid stored value falls back safely
- **GIVEN** browser or owner preference storage contains a non-boolean rail value
- **WHEN** the wiki surface resolves that preference
- **THEN** the rail uses the default shown state and no indeterminate layout is produced

#### Scenario: Owner preference reconciles across browsers
- **GIVEN** an authenticated owner's server preference records the rail as hidden
- **WHEN** the owner opens a wiki route in a browser with no preference or a conflicting shown preference
- **THEN** the server value becomes authoritative and the rail resolves to hidden

#### Scenario: Viewer preference remains browser-local
- **GIVEN** a viewer or anonymous session changes the rail preference
- **WHEN** the preference is saved
- **THEN** only browser storage is updated and no owner UI-preference row is read or written

### Requirement: Collapsed wiki identity opens a quick switcher

When a page is displayed at desktop width and the rail is hidden, the toolbar's current page identity SHALL combine the `W<NNNN>` id and slug into an accessible quick-switch trigger, for example `W0001 inference-kernel-learning-guide`. Activating it SHALL open a shadcn-styled Popover containing a compact, vertically scrollable list of the current project's pages grouped by kind in canonical kind order.

Each Popover item SHALL be a native link to that page's detail route, SHALL expose its id, slug, and title, and SHALL use a distinct selected treatment plus `aria-current="page"` for the current page. Selecting another page SHALL close the Popover and navigate while leaving the persisted rail state hidden. The Popover SHALL support keyboard activation, visible focus, Escape/outside dismissal, and focus return to its trigger. While the page list query is pending, the Popover SHALL show the same list loading treatment as the full rail rather than an empty-list message.

When the desktop rail is shown, the identity SHALL remain ordinary toolbar metadata and SHALL NOT open a duplicate quick switcher. On mobile, the identity SHALL remain non-interactive and the page Sheet SHALL remain the switching surface.

#### Scenario: Collapsed identity opens the page list
- **GIVEN** the desktop rail is hidden while `W0001 inference-kernel-learning-guide` is selected
- **WHEN** the user activates the current page identity
- **THEN** a Popover opens with the project's pages in rail order
- **AND** `W0001` is marked as the current native link

#### Scenario: Quick switch navigates without expanding the rail
- **GIVEN** the quick-switch Popover is open and another page `W0002` is available
- **WHEN** the user activates the `W0002` link
- **THEN** the Popover closes and navigation targets the `W0002` detail URL
- **AND** the persisted desktop rail preference remains hidden

#### Scenario: Long lists scroll inside the Popover
- **GIVEN** the project has more pages than fit in the Popover's bounded viewport height
- **WHEN** the quick switcher opens
- **THEN** the list scrolls vertically inside the Popover
- **AND** the surrounding document does not need to scroll to reach every option

#### Scenario: Keyboard dismissal returns focus
- **GIVEN** the quick-switch Popover was opened from the current page identity
- **WHEN** the user presses Escape
- **THEN** the Popover closes and keyboard focus returns to the identity trigger

#### Scenario: Expanded and mobile identities stay non-interactive
- **WHEN** the rail is expanded, or the wiki page is displayed below the desktop breakpoint
- **THEN** the current page identity does not expose the quick-switch trigger
- **AND** the desktop rail or mobile Sheet remains the applicable switching mechanism

### Requirement: Mobile wiki layout uses a single column and a page Sheet

On viewports narrower than the `md` breakpoint, the wiki surface SHALL render a single column showing the selected page's reading surface, or the empty state when none is selected. Both the right outline and the inline table of contents SHALL be hidden. A floating action button anchored at `bottom-right` SHALL be visible only on mobile. Activating it SHALL open a Sheet drawer from the right edge containing the same grouped, filterable page list. Selecting an entry SHALL navigate to that page's URL and close the drawer.

#### Scenario: Mobile default view
- **WHEN** the user opens a wiki URL at viewport width below `md`
- **THEN** the layout shows only the selected page's reading surface with the floating action button at bottom-right
- **AND** no rail is visible

#### Scenario: Button opens the page drawer
- **WHEN** the user taps the floating action button
- **THEN** a Sheet slides in from the right showing the same flat page list with its filters
- **AND** the rendered page remains in the background behind the Sheet's overlay

#### Scenario: Drawer selection navigates and closes
- **WHEN** the user taps a page inside the drawer
- **THEN** the URL navigates to that page's detail route, the drawer closes, and the reading surface updates

### Requirement: Mobile wiki edit mode is full-viewport

On mobile, activating Edit SHALL open the Monaco editor in a full-viewport Sheet (`side="bottom"`, `h-[100svh]`) that covers the AppBar and the wiki layout below, with a sticky toolbar carrying Save and Cancel. A successful Save SHALL close the editor and refresh the rendered view; Cancel SHALL discard local edits and close without writing.

#### Scenario: Mobile edit takeover
- **WHEN** the user taps Edit on mobile
- **THEN** a Sheet slides up from the bottom and covers the entire viewport including the AppBar
- **AND** Monaco is mounted inside the Sheet with the page's current content

#### Scenario: Mobile save closes the editor
- **WHEN** the user taps Save and the write succeeds
- **THEN** the Sheet closes and the underlying rendered view shows the saved content

#### Scenario: Mobile cancel discards edits
- **WHEN** the user taps Cancel
- **THEN** the Sheet closes immediately without writing and unsaved typing is lost

### Requirement: Editing a page uses optimistic locking with a recoverable conflict flow

The wiki editor SHALL submit writes to the page write endpoint with `expectedMtime` and `expectedHash` taken from the content as last fetched. On a 409 CONFLICT response the UI SHALL show a toast stating the on-disk content changed since the editor opened, offering a Reload action that re-fetches and re-mounts the editor with the fresh content. The editor SHALL stay open with the user's unsaved typing intact until they choose Reload, and SHALL NOT silently overwrite a divergent on-disk version. A rejected identity change (a write that alters `id` or `kind`) SHALL surface as an actionable error that keeps the buffer open.

#### Scenario: Save under concurrent external write
- **GIVEN** the user has the editor open with content fetched earlier
- **WHEN** an external process writes the file and the user then activates Save
- **THEN** the write is rejected with 409 and the UI shows an external-edit toast with a Reload action
- **AND** the editor stays open with the unsaved typing intact until Reload is chosen

#### Scenario: Successful save updates the rendered view
- **WHEN** the user activates Save and the write returns the new mtime and hash
- **THEN** the editor closes and the rendered Markdown reflects the new content without a second fetch

#### Scenario: Identity change is reported, not silently dropped
- **WHEN** the buffer changes the page's `id` or `kind` and the user activates Save
- **THEN** the rejection surfaces as an actionable error naming the field
- **AND** the editor keeps the buffer so the user can revert the field

### Requirement: Wiki review History panel verifies commits in order

The wiki surface SHALL expose an owner-only "History" panel listing every wiki commit from `GET /api/wiki/review` oldest first with SHA (abbreviated), authored time, subject, touched page ids (each a link), and a verified mark. A single "Verify next" action SHALL target the oldest unverified commit, show its diff (via the existing git history dialog machinery, filtered to `docs/wiki/`), and on confirmation issue `POST /api/wiki/review/<sha>`; each verified row SHALL offer "Unverify" (cascading, with a confirmation naming how many newer marks are removed). Per-commit marks SHALL never be offered out of order. The panel SHALL be hidden for viewers and for non-git projects, and the older commit-marks entry points in the git history dialog SHALL be labelled "(deprecated)" while they remain.

#### Scenario: Verify next
- **GIVEN** wiki commits `c1` (verified), `c2`, `c3`
- **WHEN** the owner activates "Verify next" and confirms
- **THEN** `c2` is marked, the row shows the mark, and "Verify next" now targets `c3`

#### Scenario: Viewer sees no panel
- **GIVEN** a viewer share session
- **WHEN** the wiki surface renders
- **THEN** no History panel or review actions are rendered

### Requirement: Rendered pages distinguish unverified content

The reading pane SHALL render a review badge (`VERIFIED` / `CHANGED_SINCE_VERIFY` / `UNVERIFIED`) in the frontmatter panel with `verifiedThrough` and a "changes since verification" link that opens the page diff from `verifiedThrough` to the working tree. For `CHANGED_SINCE_VERIFY` pages the body blocks intersecting `unverifiedRanges` SHALL be rendered with a distinct left border and tinted background and a hover title naming the commit(s) (or "uncommitted") that introduced them; `UNVERIFIED` pages SHALL keep their review badge and explanatory hover title but SHALL NOT wrap the whole body in a tinted background, left border, rounded quote box, or quote-like padding; `VERIFIED` pages SHALL render without tint. The tint SHALL use theme tokens (never hard-coded colours) and SHALL be present in both light and dark themes.

#### Scenario: Partially verified page
- **GIVEN** `W0004` with `unverifiedRanges: [[12,18]]`
- **WHEN** the page renders
- **THEN** only the block(s) covering lines 12-18 carry the unverified tint and hover title

#### Scenario: Verified page is clean
- **GIVEN** `W0001` is `VERIFIED`
- **WHEN** the page renders
- **THEN** no block carries the tint and the badge reads `VERIFIED`

#### Scenario: Unverified page remains plain prose
- **WHEN** an entirely unverified page renders
- **THEN** its body has no whole-page quote decoration and its UNVERIFIED review badge remains visible

### Requirement: Empty wiki state points at the skill and CLI

When the project has no wiki pages, the reading pane SHALL render an empty state whose copy names the `memon-wiki` skill and the `memon wiki create` command as the ways to add the first page, and the rail SHALL show a small "no pages" placeholder. Inline code in that copy SHALL render with the shared chip treatment: no literal backtick characters, muted background fill, rounded corners, and a font size and weight not exceeding the surrounding body text.

#### Scenario: Empty wiki directory
- **WHEN** `docs/wiki/` is empty or missing for the project
- **THEN** the reading pane shows the empty-state copy referencing `memon-wiki` and `memon wiki create`
- **AND** the rail shows a "no pages" placeholder

#### Scenario: Empty-state code renders as chips
- **WHEN** the empty state renders `memon wiki create`
- **THEN** the text appears in the monospace face with no backtick characters around it
- **AND** the rendered chip is visually distinct from the surrounding body text via its background fill

### Requirement: Wiki surfaces update live from external writes

The wiki surface SHALL react to page additions, deletions, and content edits performed outside the dashboard without a full-page reload. A `wiki-change` event for the current project SHALL invalidate `['wiki', project]` and, for the affected page, `['wiki-page', project, id]`. Because staleness is derived from cited Experiments, an `experiment-change` event SHALL additionally invalidate `['wiki', project]` so status and stale indicators re-render. Because a bare `R<NNNN>` token resolves to a wiki page only while no Report owns that id, a `reports-change` event SHALL also invalidate `['wiki', project]` so legacy-id resolution and migration results appear without a reload.

#### Scenario: New page appears in the rail
- **WHEN** an agent writes a new page under `docs/wiki/<kind>/`
- **THEN** within the polling backoff window a `wiki-change` event fires and the rail re-renders with the new entry in its kind group
- **AND** the user does not need to refresh

#### Scenario: External edit refreshes the rendered view
- **WHEN** an external process edits the currently-selected page and no editor is open
- **THEN** the rendered surface updates to the new content
- **AND** with the editor open the user instead receives the conflict toast on save

#### Scenario: Experiment change refreshes stale indicators
- **GIVEN** page `W0004` cites `E0017` and currently shows no stale indicator
- **WHEN** an `experiment-change` event fires for that project after `E0017` is updated
- **THEN** the wiki list is refetched and `W0004`'s card shows the stale indicator

#### Scenario: Report migration refreshes legacy-id resolution
- **GIVEN** a wiki page carries `legacy_id: R0007` while Report `R0007` still exists
- **WHEN** `memon wiki migrate-report` deletes that Report and a `reports-change` event fires
- **THEN** the wiki list is refetched and a bare `R0007` token now resolves to that wiki page
- **AND** no full-page reload is required

### Requirement: Experiment detail lists the wiki pages that cite it

The Experiment detail page SHALL render a "Cited by wiki" list under its action bar, populated from the Experiment detail response's `citedBy` entries, each showing the page's `W<NNNN>` id, title, kind, status badge when its kind defines one, stale indicator when stale, and the entry's `reviewState` as a review badge using the same treatment as the rail cards. Activating an entry SHALL open that page in the side wiki surface without navigating away from the Experiment. When `citedBy` is empty the section SHALL be omitted rather than rendering an empty container.

#### Scenario: Citing pages are listed
- **GIVEN** `W0004` (finding, VERIFIED) and `W0009` (bottleneck, OPEN) both cite `E0017`
- **WHEN** the Experiment detail page for `E0017` renders
- **THEN** a "Cited by wiki" list shows both entries with their ids, titles, kinds, status badges, and review badges

#### Scenario: Entry opens the page beside the Experiment
- **GIVEN** the "Cited by wiki" list shows `W0004`
- **WHEN** the user activates that entry
- **THEN** `W0004` opens in the side wiki surface
- **AND** the Experiment remains on the left with its existing state

#### Scenario: No citations hides the section
- **WHEN** an Experiment's `citedBy` list is empty
- **THEN** no "Cited by wiki" section is rendered on its detail page
