## REMOVED Requirements

### Requirement: Wiki review History panel verifies commits in order

**Reason**: Human Wiki review and its Git-derived verification workflow are retired.
**Migration**: Existing review CSV files can remain as inert historical files. Readers and writers do not consult them; use ordinary Wiki content and Git history without review marks.

### Requirement: Rendered pages distinguish unverified content

**Reason**: Human Wiki review and its Git-derived verification workflow are retired.
**Migration**: Existing review CSV files can remain as inert historical files. Readers and writers do not consult them; use ordinary Wiki content and Git history without review marks.

## MODIFIED Requirements

### Requirement: Rail entries use compact cards showing status, staleness, and review state

Each page entry in the desktop rail and in the mobile page Sheet SHALL render as one compact card-like link. The list SHALL use consistent inset padding and spacing between cards instead of full-width divider rows. Each card SHALL use shadcn semantic surface, border, accent, foreground, and focus-ring tokens and SHALL expose, in this hierarchy: a kind badge (the `kind` label), the page title, then — when present — its `description` as a secondary line clamped to two lines, and a muted meta line with its `W<NNNN>` id and relative last-edit time. A page whose kind defines a status vocabulary SHALL show that status as a badge; a page whose list projection reports `stale: true` SHALL show an accessible stale indicator distinguishable from the status badge and SHALL expose the offending `staleSources` as hover or accessible description text.

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
- **GIVEN** a page has status and stale metadata plus historical review marks
- **WHEN** its card renders
- **THEN** the status and stale indicator remain visible and no review badge is rendered

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

### Requirement: Experiment detail lists the wiki pages that cite it

The Experiment detail page SHALL render a "Cited by wiki" list under its action bar, populated from the Experiment detail response's `citedBy` entries, each showing the page's `W<NNNN>` id, title, kind, status badge when its kind defines one, stale indicator when stale. Activating an entry SHALL open that page in the side wiki surface without navigating away from the Experiment. When `citedBy` is empty the section SHALL be omitted rather than rendering an empty container.

#### Scenario: Citing pages are listed
- **GIVEN** `W0004` (finding, VERIFIED) and `W0009` (bottleneck, OPEN) both cite `E0017`
- **WHEN** the Experiment detail page for `E0017` renders
- **THEN** a "Cited by wiki" list shows both entries with their ids, titles, kinds, status badges, and stale indicators

#### Scenario: Entry opens the page beside the Experiment
- **GIVEN** the "Cited by wiki" list shows `W0004`
- **WHEN** the user activates that entry
- **THEN** `W0004` opens in the side wiki surface
- **AND** the Experiment remains on the left with its existing state

#### Scenario: No citations hides the section
- **WHEN** an Experiment's `citedBy` list is empty
- **THEN** no "Cited by wiki" section is rendered on its detail page

## ADDED Requirements

### Requirement: Wiki presentation has no verification controls

Wiki cards, reading surfaces and Experiment backlinks SHALL omit review badges, verification actions, review-history panels, verification diff links and line-range review decorations. Existing Markdown, callouts, HTML assets, checklists and optimistic document editing SHALL continue to work.

#### Scenario: Page renders without review UI
- **WHEN** an owner or viewer opens a Wiki page
- **THEN** the content renders without any verification controls or review decoration
