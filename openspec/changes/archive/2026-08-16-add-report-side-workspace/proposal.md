## Why

Reports currently replace the document the user is reading, so comparing an Experiment (or another project document) with a Report requires repeated route changes and loses working context. The existing terminal split also divides the whole project shell, which incorrectly excludes the AppBar from the shared workspace header, while Markdown references remain ordinary text or file links instead of participating in this paired-document workflow.

## What Changes

- Add a Report surface that can open in a right-side drawer or resizable right split while the current project document remains on the left.
- Make the active Report pane URL-addressable and restorable after refresh, browser history navigation, and ordinary left-side navigation.
- Give the side Report header a shadcn-styled Report identity quick switcher that replaces only the active right-side Report.
- Recognize resolvable Experiment and Report references in Markdown, both as bare `Exxxx` / `Rxxxx` tokens and as existing relative or absolute Markdown links, and route them according to whether the source is an Experiment, a full-page Report, or a side Report.
- Preserve an open right-side Report when navigating between Experiment documents; replace it when a Report reference is selected; and pair a Report with the selected Experiment when an Experiment reference is selected from Report content.
- Refactor terminal split placement so the project AppBar remains a shared header spanning the left document and right pane, and make terminal and Report surfaces share one mutually exclusive right-side slot.
- Keep unresolved, ambiguous, external, and non-document links on their existing behavior instead of guessing a target.
- Add shared zoom controls to Report HTML iframe embeds, starting at 100% and changing in 10% steps.
- Add a generated Table of contents at the beginning of Report bodies with stable links to their Markdown section headings.

## Capabilities

### New Capabilities

- `report-workspace`: URL-addressable Report drawer/split surfaces, side-pane Report switching, paired Experiment/Report navigation, and artifact-reference resolution rules.

### Modified Capabilities

- `browser-terminal`: Mount the terminal split below the shared page header and coordinate it with the single right-side workspace slot.
- `web-layout`: Keep the AppBar spanning the full workspace above both left and right split regions.
- `markdown-link-preview`: Permit the shared Markdown renderer to enhance resolvable local Experiment/Report references while retaining existing GitHub preview and ordinary-link fallbacks.
- `web-dashboard`: Let Report HTML embeds share an explicit user-controlled zoom percentage.
- `inbox-viewer`: Render the same generated Report table of contents in full-page and side-pane reading surfaces.

## Impact

- Affects the root surface provider, project/manage layouts, terminal split shell, Report viewer components, shared Markdown renderer, and Experiment/Report navigation.
- Adds client-side URL-state and artifact-reference resolution helpers plus focused browser/component tests.
- Reuses the existing Reports APIs and React Query data; no storage schema or backend write API changes are required.
- Existing full-page Report routes, Report editing, terminal drawer/popup behavior, unrelated query parameters, and ordinary Markdown links remain compatible.
