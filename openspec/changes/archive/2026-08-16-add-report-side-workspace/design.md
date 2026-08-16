## Context

The existing `TerminalDrawerProvider` owns terminal target and presentation state at the application root. For split mode it currently wraps the entire application tree in a horizontal flex shell, so the project AppBar and manage header are compressed into the left region. Report rendering is coupled to `InboxShell`, while Markdown has a centralized anchor override but no source-document or source-surface context.

Experiment and Report list/detail APIs already expose canonical IDs and absolute source Markdown paths. Reports may be standalone Markdown files or bundles whose canonical document is `README.md`; Experiments may likewise use a bundled `README.md`. Existing React Query keys make these inventories reusable without a new backend endpoint.

## Goals / Non-Goals

**Goals:**

- Keep surface state centralized while moving split layout below the shared header.
- Make URL state the durable source of truth for a side Report.
- Reuse the same Report document rendering in full-page and side surfaces.
- Separate artifact recognition, URL construction, and visual rendering into independently testable units.
- Preserve normal browser/link semantics with canonical internal hrefs.
- Give all HTML embeds in one Report surface a consistent, non-reloading zoom control.
- Give full-page and side-pane Reports the same generated section outline at the beginning of the body.

**Non-Goals:**

- Persist terminal targets in the URL.
- Add cross-project artifact navigation or guess links from filenames that are not in the current project inventory.
- Turn arbitrary source-code Markdown files into Memon document routes.
- Change Report editing, storage formats, Report/Experiment IDs, or backend discovery rules.
- Preserve a target Markdown heading fragment inside a separately scrolling side Report in this iteration.

## Decisions

### 1. Keep one root surface coordinator and add layout outlets below headers

The root provider will continue to own the active terminal target and drawer rendering so terminal attachment survives App Router navigation. It will gain Report surface coordination and expose compatible terminal methods plus a Report workspace API. Only one union member—terminal or Report—can occupy the workspace surface at a time.

The provider will stop wrapping `children` in its split flex shell. A client workspace outlet will instead be mounted after the project AppBar and after the manage header. The outlet renders the unchanged page subtree as its left child and, when requested, the active surface as its resizable right child. Drawer surfaces remain portals owned by the root coordinator.

This retains cross-route provider state while fixing the AppBar boundary. A second independent Report provider was rejected because it would allow terminal and Report panes to compete for the same width and complicate footer/layout offsets.

### 2. Use URL query state for Reports, local state for terminals

Side Reports use `report=<Rxxxx>` and `reportSurface=split|drawer`. Report open/switch/move/close helpers clone the current URL and alter only these two parameters with scroll-disabled App Router replacement. The outlet derives the active Report directly from the current search parameters, so reload and browser history do not require a localStorage/session state mirror.

Malformed IDs result in no Report surface. Well-formed missing IDs remain addressable and render a not-found surface with switch/close controls. Canonical full-page Report routes suppress the side surface to avoid duplicate rendering.

Opening a terminal removes Report parameters; opening a Report hides the active terminal browser surface without calling the stop API. Terminal target identity remains in provider memory so its backend can be reattached through existing flows.

An alternative single encoded `right=report:R0001` value was considered. Separate parameters are easier to inspect, preserve, validate, and update without string parsing, and directly satisfy the requested query-string visibility.

### 3. Extract a controlled, read-only Report document surface

Report body/frontmatter rendering and artifact identity UI will be extracted from `InboxShell` into reusable components. The full inbox retains its rail and editing behavior; the side surface fetches the same list/detail queries, renders the same frontmatter, Markdown, bundle resources, HTML embeds, loading/error states, and provides an always-available identity Popover.

The side quick switcher uses controlled destinations that update `report` only. It does not reuse full-page rail hrefs verbatim, because those would replace the left document.

### 4. Resolve artifacts from current-project inventory, never filename shape alone

A pure resolver consumes the source Markdown path plus the current project's Experiment and Report inventories. For existing Markdown hrefs it:

1. Rejects external/protocol-relative schemes, query-only and fragment-only hrefs.
2. Separates query/fragment from the path.
3. Resolves a relative path lexically from the source file's directory, or normalizes an absolute path.
4. Safely decodes URL path segments and rejects malformed encodings, encoded separators, NUL, and paths without an exact inventory match.
5. Returns a target only when its route identity is unique.

This supports legacy/bundled Experiment documents and standalone/bundled Reports because their actual API `path` values are the inventory keys. It also recognizes canonical Memon web routes before filesystem resolution. Cross-project and ambiguous migration collisions remain ordinary links.

Filename-pattern-only resolution was rejected because it would create convincing links to nonexistent, cross-project, or ambiguous artifacts.

### 5. Add bare identifiers through an AST transform and explicit links through the anchor renderer

A remark transform recursively splits eligible text nodes around standalone uppercase `R\d{4}` and `E\d{4}` tokens (plus an optional canonical Experiment slug) and emits real link nodes only for unique inventory matches. It skips links/link references, inline and fenced code, math, and raw HTML, preventing nested links and false positives.

Existing Markdown links are resolved in the anchor renderer before Report-bundle resource rewriting. GitHub blob line-permalinks retain first priority, followed by artifact resolution, then bundle resource rewriting, then the existing ordinary-link fallback.

Both paths construct a canonical application href from a six-cell navigation matrix: left/full-Report/side-Report source crossed with Experiment/Report target. This lets normal anchors or Next links handle keyboard activation, modifier clicks, and reload fallback without an imperative click-only router.

### 6. Accent only the literal artifact-ID substring

The link remains semantically clickable across its complete generated or authored label, but only the visible `Rxxxx` or `Exxxx` substring is wrapped in a bold `text-primary` span. Punctuation, titles, and Experiment slug suffixes retain ordinary link typography. Labels without a literal identifier gain artifact navigation but no invented or whole-label emphasis.

The renderer will recursively decorate text children rather than styling the anchor itself. This satisfies labels such as `R0007: Inference Kernel Learning Guide` without coloring or bolding the title.

### 7. Reuse and generalize the resize implementation

Drawer and split widths keep separate persisted keys. The resize hook/handle will be generalized enough to supply Report-appropriate accessible labels and a shared right-pane width CSS variable. Split clamping will use the outlet's available width rather than assuming the entire viewport, because the project sidebar is outside the outlet. The fixed project footer will consume the shared right-pane width so it does not sit underneath the pane.

### 8. Keep same-left Report mutations out of App Router navigation

Artifact destinations remain real canonical hrefs and use soft Next links when the pathname changes. When only `report` / `reportSurface` changes on the same left pathname, the click handler and Report controller use the native History replacement API plus a workspace synchronization event. This updates the URL and Report provider immediately without requesting a new server component payload or remounting the left document.

The split divider tracks pointer movement and release on `window` for the duration of a drag, rather than depending only on events delivered over its original narrow element. Pointer capture remains an enhancement, while window tracking keeps resizing stable over iframes and either content pane.

### 9. Scale Report iframe viewports inside a Report-scoped provider

`RenderedItem` owns a zoom provider with a 100% default. Every HTML embed beneath it consumes the same percentage and updates in bounded 10-point steps. The iframe receives an inverse width/height and a top-left CSS transform, so its visual boundary continues to fill the fixed host viewport while its document is enlarged or reduced. Changing zoom updates styles on the existing iframe node and does not restart its loading lifecycle.

### 10. Generate the Report outline from the rendered Markdown tree

The Report-only Markdown pipeline derives a table of contents from level-two through level-six headings, assigns the matching headings stable Report-prefixed IDs, and inserts an accessible navigation region before the document title. Repeated labels gain deterministic numeric suffixes, and Unicode heading text remains readable in both the directory and target anchor. The document-level H1 receives an anchor but is omitted from the outline because linking back to the Report title adds no navigation value.

Generating the outline in the same remark transform that assigns heading IDs avoids a second parser and guarantees that inline formatting, duplicate labels, and the visible heading targets stay synchronized. The shared `RenderedItem` boundary enables it for both full-page and side Reports while leaving Digests and unrelated Markdown surfaces unchanged.

## Risks / Trade-offs

- **[Risk] URL updates and provider updates can form a render loop** → Treat Report query state as authoritative; provider methods only write URL state, and effects never mirror it back into independent selected-Report state.
- **[Risk] Moving the split changes height and scroll ownership across many pages** → Keep AppBar/manage header fixed in their current flex column, give the outlet `min-h-0 flex-1`, preserve the page subtree, and test representative Experiment, Report, terminal, and manage pages.
- **[Risk] Absolute local paths are sensitive information if rendered into browser hrefs** → Paths are used only for in-memory exact matching; generated hrefs contain canonical project routes and IDs, never filesystem paths.
- **[Risk] Report bundle links may be mistaken for downloadable resources** → Artifact resolution precedes bundle resource rewriting and requires an exact canonical document inventory match.
- **[Risk] Short Experiment IDs can be ambiguous** → Only unique current-project matches produce links; ambiguous references stay text or keep their authored href.
- **[Trade-off] Heading fragments are recognized but side-pane scroll targeting is deferred** → Artifact identity and pairing are correct; target-fragment preservation can be added later without changing resolver identity rules.

## Migration Plan

1. Introduce pure URL and artifact resolvers with unit tests.
2. Refactor the root surface coordinator and mount workspace outlets below existing headers while retaining terminal APIs.
3. Extract reusable Report rendering and add drawer/split plus quick switching.
4. Thread Markdown source/surface context through Experiment and Report renderers and enable both reference paths.
5. Run focused browser/component tests, type checking, and the production build before replacing the service on port 3737.

Rollback is code-only: the change adds no persisted server data or schema. Existing URLs without Report parameters and canonical full-page Report routes continue to work throughout deployment.
