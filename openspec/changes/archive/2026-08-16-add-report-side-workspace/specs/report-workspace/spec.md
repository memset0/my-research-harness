## Purpose

Provide a restorable paired-document workspace in which project Markdown and Experiments remain usable on the left while Reports can be read and switched in a drawer or right split, with references navigating consistently between both sides.

## ADDED Requirements

### Requirement: Reports open in a drawer or right split

The project workspace SHALL allow a Report to be opened in either an overlay drawer or a resizable right split without replacing the current left-side project page. The split SHALL keep the left page interactive, provide independent scrolling for both regions, and expose controls to move the same Report between drawer and split, open its canonical full-page route, or close it. On viewports that cannot support two usable columns, a requested split SHALL render as a drawer.

Terminal and Report surfaces SHALL share one active right-side workspace slot. Opening either kind SHALL replace the other visible surface rather than rendering two competing right panes.

#### Scenario: Open Report beside an Experiment
- **GIVEN** an Experiment page is open on a desktop viewport
- **WHEN** the user opens `R0001` in the right split
- **THEN** the Experiment remains visible and interactive on the left
- **AND** `R0001` is rendered on the right without a modal backdrop

#### Scenario: Drag the divider between Experiment and Report
- **GIVEN** an Experiment and Report are visible in the desktop split
- **WHEN** the user drags the divider between them in either direction, including beyond the divider's original hit area
- **THEN** pointer movement continues to resize the right Report until release
- **AND** both sides remain within their minimum usable widths

#### Scenario: Move Report between surfaces
- **GIVEN** a Report is open in the right split
- **WHEN** the user chooses the drawer presentation
- **THEN** the same Report moves to the drawer without navigating or losing the left page

#### Scenario: Mobile split falls back to drawer
- **WHEN** a Report split is requested below the supported workspace breakpoint
- **THEN** the Report opens in the drawer
- **AND** the left page is not compressed into an unusable column

#### Scenario: Report replaces terminal in the shared slot
- **GIVEN** a terminal is visible in the right split
- **WHEN** the user opens a Report on the right
- **THEN** the terminal surface is hidden and the Report occupies the single right-side slot
- **AND** hiding the terminal does not stop its backend session

### Requirement: Report workspace state is encoded in the URL

An active side Report SHALL be represented by the current URL's `report=<R-id>` query parameter and its requested presentation SHALL be represented by `reportSurface=split|drawer`. Opening, switching, moving, or closing the Report SHALL modify only those parameters, preserving unrelated query parameters and the current left-side path. A valid side-Report URL SHALL restore the same Report and presentation after reload and browser history traversal. A missing or malformed Report parameter SHALL render no Report surface; a well-formed but missing Report SHALL retain the URL and show a recoverable not-found state.

When an action changes only the side Report identity, presentation, or visibility while the left pathname is unchanged, the dashboard SHALL update browser history and the right surface without a document reload, server-route navigation, or remount of the left page subtree. Existing left-side component state and loaded Experiment data SHALL remain in place.

The side-Report parameters SHALL NOT create a duplicate pane on a canonical full-page Report detail route. Normal navigation to another left-side project document SHALL preserve an active side Report unless the destination is a canonical full-page Report route or the action explicitly closes/replaces the workspace surface.

#### Scenario: Reload restores paired documents
- **GIVEN** the URL is `/p/vsqa/e/E0017-vsqa-fvfa4-inference?run=sample&report=R0007&reportSurface=split`
- **WHEN** the page is reloaded
- **THEN** the same Experiment and run selection remain on the left
- **AND** `R0007` is restored in the right split

#### Scenario: Switching Report preserves unrelated URL state
- **GIVEN** an Experiment URL contains `run=sample`, `report=R0007`, and `reportSurface=split`
- **WHEN** the user switches the side Report to `R0003`
- **THEN** the URL retains `run=sample` and the Experiment pathname
- **AND** only the Report identity changes to `report=R0003`

#### Scenario: Opening or switching Report does not reload the left Experiment
- **GIVEN** Experiment `E0017` is already rendered with client state and loaded query data
- **WHEN** a Report link opens `R0007` or the right quick switcher replaces it with `R0003`
- **THEN** the browser URL and right Report update without a document or server-route reload
- **AND** the existing `E0017` component instance and its client state remain mounted

#### Scenario: Closing removes only Report state
- **WHEN** the user closes the Report surface
- **THEN** `report` and `reportSurface` are removed from the URL
- **AND** all unrelated query parameters and the left-side pathname remain unchanged

#### Scenario: Missing Report has recoverable state
- **GIVEN** the URL contains a syntactically valid Report ID that does not exist in the project
- **WHEN** the workspace loads
- **THEN** the right surface shows a not-found state with close and switch controls
- **AND** the URL is not silently redirected to another Report

### Requirement: Side Report exposes an accessible quick switcher

The side Report header SHALL render the active Report ID and slug as a quick-switch trigger. Activating it SHALL open a shadcn-styled Popover containing the current project's Reports with ID, slug, and title, a selected treatment for the active Report, a bounded scroll region, loading and empty states, keyboard focus behavior, and Escape/outside dismissal. Selecting another Report SHALL replace only the side Report and leave the left-side pathname and unrelated query state unchanged.

#### Scenario: Side identity switches only the right Report
- **GIVEN** `R0001` is open beside Experiment `E0017`
- **WHEN** the user opens the Report identity Popover and selects `R0007`
- **THEN** `R0007` replaces `R0001` on the right
- **AND** `E0017` remains on the left

#### Scenario: Quick switcher is keyboard accessible
- **WHEN** the side Report identity is focused and activated from the keyboard
- **THEN** the Report list opens with visible focus behavior and marks the current item
- **AND** pressing Escape closes it and returns focus to the trigger

### Requirement: Resolvable bare artifact identifiers become styled links

In project Markdown with project and source-document context, standalone uppercase `R` followed by exactly four digits and standalone uppercase `E` followed by exactly four digits (optionally followed by the canonical Experiment slug) SHALL become internal artifact links only when they resolve uniquely to a current-project Report or Experiment. Within a generated link, only the uppercase-letter-plus-four-digits identifier segment SHALL use bold text and the theme's `primary` foreground color. Any suffix, punctuation, slug, or neighboring label text SHALL NOT inherit those emphasis styles.

Matching SHALL use token boundaries and SHALL NOT transform substrings inside longer identifiers. The renderer SHALL NOT transform identifiers inside existing links, inline code, fenced code, raw HTML, or math, and SHALL leave unknown or ambiguous identifiers as ordinary text.

#### Scenario: Bare Report and Experiment IDs become primary links
- **GIVEN** Markdown text contains `See R0007 and E0017 for details` and both artifacts exist uniquely
- **WHEN** the Markdown renders
- **THEN** the exact `R0007` and `E0017` identifier segments are bold and use the theme primary color
- **AND** text outside those identifier segments does not inherit the bold primary treatment

#### Scenario: Code and unresolved IDs remain unchanged
- **GIVEN** Markdown contains inline code `` `R0007` ``, fenced code containing `E0017`, and unknown text `R9999`
- **WHEN** the Markdown renders
- **THEN** none of those three occurrences is converted into an artifact link

### Requirement: Existing Markdown file links are resolved to artifacts

When an existing Markdown link targets a current-project Experiment or Report document, the renderer SHALL recognize it as an artifact link even when its label does not contain an artifact ID. Resolution SHALL support relative paths resolved from the source Markdown file, absolute filesystem paths equal to a discovered artifact source, canonical project web routes, standalone Report files, Report bundle `README.md` files, and Experiment bundle `README.md` files. Query strings and fragments SHALL not prevent target recognition.

Resolved artifact links SHALL use the same contextual navigation semantics as generated bare-identifier links. When the visible Markdown link label contains the resolved `Rxxxx` or `Exxxx` token, only that identifier substring SHALL receive the bold theme-primary treatment; the rest of the link label SHALL retain its ordinary link typography. A label without an identifier remains fully clickable but gains no invented or whole-label emphasis. External URLs, non-Markdown files, paths outside the current project, and unresolved or ambiguous document paths SHALL retain their original link target and ordinary link behavior. Existing GitHub permalink previews SHALL remain unaffected.

#### Scenario: Relative Report link is recognized from an Experiment
- **GIVEN** Experiment `E0017` contains `[R0007: learning guide](../../reports/R0007-inference-kernel-learning-guide/README.md)`
- **WHEN** the link renders and is activated
- **THEN** the `R0007` part of its visible label is bold and theme-primary while the remaining label text is not
- **AND** `R0007` opens in or replaces the right Report surface

#### Scenario: Relative Experiment link is recognized from a Report
- **GIVEN** a Report contains `[E0017 current experiment](../experiments/E0017-vsqa-fvfa4-inference/README.md)`
- **WHEN** the link renders and is activated
- **THEN** only an `E0017` token present in its visible label receives the bold theme-primary treatment
- **AND** the paired workspace navigates the left side to canonical Experiment `E0017-vsqa-fvfa4-inference`

#### Scenario: Ordinary Markdown link remains ordinary
- **GIVEN** a Markdown link points to a source-code README, an external site, or an unresolved local file
- **WHEN** the Markdown renders
- **THEN** its href and ordinary link behavior remain unchanged

### Requirement: Artifact links follow paired-workspace navigation rules

Artifact-link activation SHALL depend on the source surface and target kind:

- From an Experiment or other left-side project document, an Experiment target SHALL navigate the left side while retaining any active side Report, and a Report target SHALL open or replace the right-side Report.
- From a canonical full-page Report, an Experiment target SHALL navigate to the Experiment on the left and pair the current Report on the right, while a Report target SHALL navigate directly to that Report's canonical full-page route.
- From a side Report, an Experiment target SHALL replace the left-side document while retaining the current Report on the right, and a Report target SHALL replace only the right-side Report.

Generated destinations SHALL use canonical full Experiment IDs and SHALL preserve unrelated left-page query state when it remains applicable. Activation SHALL use normal internal-link semantics so keyboard activation and browser fallback remain available.

#### Scenario: Experiment-to-Experiment preserves side Report
- **GIVEN** `E0017` is on the left and `R0007` is on the right
- **WHEN** an Experiment link to `E0018` is activated from the left document
- **THEN** the left side navigates to canonical `E0018`
- **AND** `R0007` remains on the right

#### Scenario: Experiment-to-Report replaces side Report
- **GIVEN** `E0017` is on the left and `R0007` is on the right
- **WHEN** a Report link to `R0003` is activated from the left document
- **THEN** `R0003` replaces `R0007` on the right
- **AND** `E0017` remains on the left

#### Scenario: Full Report-to-Experiment creates paired view
- **GIVEN** canonical full-page Report `R0003` is open
- **WHEN** its content activates a link to `E0017`
- **THEN** canonical `E0017` becomes the left page
- **AND** `R0003` is open on the right

#### Scenario: Full Report-to-Report stays full page
- **GIVEN** canonical full-page Report `R0003` is open
- **WHEN** its content activates a link to `R0007`
- **THEN** the browser navigates directly to canonical full-page Report `R0007`

#### Scenario: Side Report links replace the addressed side
- **GIVEN** `R0003` is open on the right of `E0017`
- **WHEN** the Report activates an Experiment link to `E0018`
- **THEN** `E0018` replaces the left page and `R0003` remains on the right
- **WHEN** the Report then activates a Report link to `R0007`
- **THEN** `R0007` replaces only the right pane and `E0018` remains on the left
