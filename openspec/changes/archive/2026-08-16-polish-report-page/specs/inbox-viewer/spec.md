## MODIFIED Requirements

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

## ADDED Requirements

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
