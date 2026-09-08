# wiki-workspace Specification

## Purpose
Provide the wiki side of the paired-document workspace: a wiki page can be read
and switched in a drawer or right split while project Markdown and Experiments
stay usable on the left, with navigation rules covering Experiment ↔ wiki and
wiki ↔ Report movement. The single right-side slot shared by Report and wiki
surfaces, the mutual exclusion of the `report=` and `wiki=` URL parameters,
and bare-identifier / Markdown-file-link resolution are specified by
`report-workspace`; this capability describes only the wiki-specific surface,
its URL parameters, its quick switcher, and its navigation matrix.

## Requirements

### Requirement: Wiki pages open in a drawer or right split

The project workspace SHALL allow a wiki page to be opened in either an overlay drawer or a resizable right split without replacing the current left-side project page. The split SHALL keep the left page interactive, provide independent scrolling for both regions, and expose controls to move the same wiki page between drawer and split, open its canonical full-page route, or close it. On viewports that cannot support two usable columns, a requested split SHALL render as a drawer.

The wiki surface SHALL participate in the single right-side workspace slot specified by `report-workspace`'s requirement "Reports open in a drawer or right split": opening a wiki page SHALL hide whichever terminal or Report surface currently occupies that slot, and SHALL never render a second competing right pane.

#### Scenario: Open wiki page beside an Experiment
- **GIVEN** an Experiment page is open on a desktop viewport
- **WHEN** the user opens `W0001` in the right split
- **THEN** the Experiment remains visible and interactive on the left
- **AND** `W0001` is rendered on the right without a modal backdrop

#### Scenario: Drag the divider between Experiment and wiki page
- **GIVEN** an Experiment and wiki page are visible in the desktop split
- **WHEN** the user drags the divider between them in either direction, including beyond the divider's original hit area
- **THEN** pointer movement continues to resize the right wiki pane until release
- **AND** both sides remain within their minimum usable widths

#### Scenario: Move wiki page between surfaces
- **GIVEN** a wiki page is open in the right split
- **WHEN** the user chooses the drawer presentation
- **THEN** the same wiki page moves to the drawer without navigating or losing the left page

#### Scenario: Mobile split falls back to drawer
- **WHEN** a wiki split is requested below the supported workspace breakpoint
- **THEN** the wiki page opens in the drawer
- **AND** the left page is not compressed into an unusable column

#### Scenario: Wiki page takes over the shared right slot
- **GIVEN** a terminal or a Report occupies the right split
- **WHEN** the user opens a wiki page on the right
- **THEN** the previous surface is hidden and the wiki page occupies the single right-side slot
- **AND** a hidden terminal keeps its backend session running

### Requirement: Wiki workspace state is encoded in the URL

An active side wiki page SHALL be represented by the current URL's `wiki=<W-id>` query parameter and its requested presentation SHALL be represented by `wikiSurface=split|drawer`. Opening, switching, moving, or closing the wiki page SHALL modify only those parameters — plus removal of the mutually exclusive `report=`/`reportSurface=` parameters as `report-workspace` requires — preserving unrelated query parameters and the current left-side path. A valid side-wiki URL SHALL restore the same page and presentation after reload and browser history traversal. A missing or malformed wiki parameter SHALL render no wiki surface; a well-formed but missing page SHALL retain the URL and show a recoverable not-found state.

When an action changes only the side page identity, presentation, or visibility while the left pathname is unchanged, the dashboard SHALL update browser history and the right surface without a document reload, server-route navigation, or remount of the left page subtree. Existing left-side component state and loaded Experiment data SHALL remain in place.

The side-wiki parameters SHALL NOT create a duplicate pane on a canonical full-page wiki detail route. Normal navigation to another left-side project document SHALL preserve an active side wiki page unless the destination is a canonical full-page wiki route or the action explicitly closes/replaces the workspace surface.

#### Scenario: Reload restores paired documents
- **GIVEN** the URL is `/p/project-a/e/E0017-inference-kernels?run=sample&wiki=W0007&wikiSurface=split`
- **WHEN** the page is reloaded
- **THEN** the same Experiment and run selection remain on the left
- **AND** `W0007` is restored in the right split

#### Scenario: Switching wiki page preserves unrelated URL state
- **GIVEN** an Experiment URL contains `run=sample`, `wiki=W0007`, and `wikiSurface=split`
- **WHEN** the user switches the side wiki page to `W0003`
- **THEN** the URL retains `run=sample` and the Experiment pathname
- **AND** only the page identity changes to `wiki=W0003`

#### Scenario: Opening or switching wiki page does not reload the left Experiment
- **GIVEN** Experiment `E0017` is already rendered with client state and loaded query data
- **WHEN** a wiki link opens `W0007` or the right quick switcher replaces it with `W0003`
- **THEN** the browser URL and right wiki pane update without a document or server-route reload
- **AND** the existing `E0017` component instance and its client state remain mounted

#### Scenario: Closing removes only wiki state
- **WHEN** the user closes the wiki surface
- **THEN** `wiki` and `wikiSurface` are removed from the URL
- **AND** all unrelated query parameters and the left-side pathname remain unchanged

#### Scenario: Missing wiki page has recoverable state
- **GIVEN** the URL contains a syntactically valid `W<NNNN>` id that does not exist in the project
- **WHEN** the workspace loads
- **THEN** the right surface shows a not-found state with close and switch controls
- **AND** the URL is not silently redirected to another page

### Requirement: Side wiki page exposes an accessible quick switcher

The side wiki header SHALL render the active page's id and slug as a quick-switch trigger. Activating it SHALL open a shadcn-styled Popover containing the current project's wiki pages in rail order (newest edit first), each item exposing kind, id, and title, with a selected treatment for the active page, a bounded scroll region, loading and empty states, keyboard focus behavior, and Escape/outside dismissal. Selecting another page SHALL replace only the side wiki page and leave the left-side pathname and unrelated query state unchanged. The switcher SHALL list wiki pages only; Reports remain reachable through their own quick switcher and links.

#### Scenario: Side identity switches only the right wiki page
- **GIVEN** `W0001` is open beside Experiment `E0017`
- **WHEN** the user opens the wiki identity Popover and selects `W0007`
- **THEN** `W0007` replaces `W0001` on the right
- **AND** `E0017` remains on the left

#### Scenario: Quick switcher follows rail order
- **GIVEN** the project has `meeting`, `finding`, and `note` pages
- **WHEN** the quick switcher opens
- **THEN** its items are listed newest-edited first, each showing its kind badge, id, and title

#### Scenario: Quick switcher is keyboard accessible
- **WHEN** the side wiki identity is focused and activated from the keyboard
- **THEN** the page list opens with visible focus behavior and marks the current item
- **AND** pressing Escape closes it and returns focus to the trigger

### Requirement: Wiki artifact links follow paired-workspace navigation rules

Wiki artifact-link activation SHALL depend on the source surface and target kind, extending the Report matrix in `report-workspace`'s requirement "Artifact links follow paired-workspace navigation rules" with the wiki cases:

- From an Experiment or other left-side project document, a wiki target SHALL open or replace the right-side surface with that wiki page while the left page stays in place.
- From a canonical full-page wiki route, an Experiment target SHALL navigate to the Experiment on the left and pair the current wiki page on the right, while a wiki target SHALL navigate directly to that page's canonical full-page route.
- From a side wiki page, an Experiment target SHALL replace the left-side document while retaining the current wiki page on the right, a wiki target SHALL replace only the right-side wiki page, and a Report target SHALL replace the shared right-side slot with that Report.
- From a side Report, a wiki target SHALL replace the shared right-side slot with that wiki page, leaving the left-side document untouched.

Generated destinations SHALL use canonical `W<NNNN>` wiki ids even when the author wrote a legacy `R<NNNN>` token that resolved through `legacy_id`, and SHALL preserve unrelated left-page query state when it remains applicable. Activation SHALL use normal internal-link semantics so keyboard activation and browser fallback remain available.

#### Scenario: Experiment-to-wiki replaces the side surface
- **GIVEN** `E0017` is on the left and `W0007` is on the right
- **WHEN** a wiki link to `W0003` is activated from the left document
- **THEN** `W0003` replaces `W0007` on the right
- **AND** `E0017` remains on the left

#### Scenario: Experiment-to-Experiment preserves the side wiki page
- **GIVEN** `E0017` is on the left and `W0007` is on the right
- **WHEN** an Experiment link to `E0018` is activated from the left document
- **THEN** the left side navigates to canonical `E0018`
- **AND** `W0007` remains on the right

#### Scenario: Full wiki-to-Experiment creates paired view
- **GIVEN** the canonical full-page wiki route for `W0003` is open
- **WHEN** its content activates a link to `E0017`
- **THEN** canonical `E0017` becomes the left page
- **AND** `W0003` is open on the right

#### Scenario: Full wiki-to-wiki stays full page
- **GIVEN** the canonical full-page wiki route for `W0003` is open
- **WHEN** its content activates a link to `W0007`
- **THEN** the browser navigates directly to the canonical full-page wiki route for `W0007`

#### Scenario: Side wiki links replace the addressed side
- **GIVEN** `W0003` is open on the right of `E0017`
- **WHEN** the wiki page activates an Experiment link to `E0018`
- **THEN** `E0018` replaces the left page and `W0003` remains on the right
- **WHEN** the page then activates a wiki link to `W0007`
- **THEN** `W0007` replaces only the right pane and `E0018` remains on the left

#### Scenario: Wiki-to-Report swaps the shared right slot
- **GIVEN** `W0003` is open on the right of `E0017`
- **WHEN** the wiki page activates a link to Report `R0007`
- **THEN** `R0007` replaces `W0003` in the shared right-side slot
- **AND** `E0017` remains on the left with its existing state

#### Scenario: Report-to-wiki swaps the shared right slot
- **GIVEN** `R0007` is open on the right of `E0017`
- **WHEN** the Report activates a link to wiki page `W0003`
- **THEN** `W0003` replaces `R0007` in the shared right-side slot
- **AND** `E0017` remains on the left

#### Scenario: Legacy token resolves to the canonical wiki destination
- **GIVEN** a left-side document contains `R0007`, Report `R0007` no longer exists, and page `W0021` carries `legacy_id: R0007`
- **WHEN** the link is activated
- **THEN** the generated destination addresses `wiki=W0021`
- **AND** the visible label still reads `R0007`
