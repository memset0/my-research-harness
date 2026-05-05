# experiment-edit Specification

## Purpose
TBD - created by archiving change add-write-flow. Update Purpose after archive.
## Requirements
### Requirement: Status edit control on the detail page

The experiment detail page SHALL provide a control (dropdown or button group) listing all 5 status enum values. Selecting a different value SHALL invoke the same atomic write protocol defined for `PUT /api/readme` and `[STATUS]` event append.

#### Scenario: Successful status change
- **WHEN** the user selects `FAILED` for an experiment whose current `status` is `RUNNING`, with a fresh `expectedMtime`
- **THEN** the page issues `PUT /api/readme` with the updated front matter, the backend writes the README and appends `[STATUS] \`<id>\` RUNNING → FAILED` to JOURNAL.md atomically, the page re-fetches the experiment, and a success toast `Saved · status FAILED` is shown for ~1s

#### Scenario: Status change race
- **WHEN** the on-disk README has changed between the page load and the status submit
- **THEN** the backend returns 409 with current content and the conflict modal opens (see "Conflict resolution dialog")

### Requirement: README inline editor

The detail page SHALL provide an `Edit README` action that mounts a Monaco-based markdown editor (via `@monaco-editor/react`) prefilled with the current README content (front matter + body). The editor SHALL render with `language: 'markdown'`, word-wrap enabled, **line numbers visible** (gutter on the left), and a **white editor canvas** (`editor.background: #ffffff`) regardless of the surrounding theme tokens — the panel chrome is grey but the writing surface itself is plain white so it reads as a sheet of paper.

The editor module (Monaco core + worker) SHALL NOT be in the initial JS bundle; it SHALL be dynamically imported the first time the user activates `Edit README`.

The editor surface SHALL include a top toolbar laid out in **two rows**, separated by a horizontal border:
- **Row 1 (controls)**: the title `Edit README` (with an unsaved-changes dot when dirty) on the left, and on the right the action cluster — Plain/Monaco toggle, Copy markdown, Cancel/Close, Save (and panel-specific Collapse/Close buttons via `toolbarTrailing`).
- **Row 2 (path)**: the full file path on its own line, rendered with a smaller monospace font (~10px) in muted color and `truncate` overflow. This row has no buttons, so its vertical padding SHALL be smaller than row 1.

The path SHALL NOT share row 1 with the action cluster — that arrangement does not fit when the path is long.

The toolbar's controls SHALL include at least:
1. A **"Plain editor"** toggle that switches the surface from Monaco to a native `<textarea>` with monospace font and no syntax highlighting. The user's preference SHALL persist in `localStorage` under key `memon:readme-editor:plain`.
2. A **"Copy markdown"** button that copies the current editor content to the system clipboard via `navigator.clipboard.writeText`. On clipboard failure, the editor SHALL select all text in the underlying surface and show a "Clipboard blocked — please copy manually" toast.

If the dynamic Monaco import rejects (network failure, runtime error), the editor SHALL automatically fall back to plain mode and show an "Editor failed to load — using plain text fallback" toast.

#### Scenario: Open and save (Monaco)
- **WHEN** the user clicks `Edit README`, makes changes in the Monaco surface, and clicks `Save`
- **THEN** the page issues `PUT /api/readme` with `{path, content, expectedMtime, expectedHash}`; on 200 the editor closes (or, on desktop, stays open with cleared dirty state — see web-dashboard spec for the layout-specific close semantics), the rendered detail view updates from the new content, and a success toast appears

#### Scenario: Lazy-loaded editor
- **WHEN** the user is on a list/detail page but has not opened any editor yet
- **THEN** Monaco core, its language workers, and `@monaco-editor/react` are NOT in the initial JS bundle (they are dynamically imported only when an editor surface mounts)

#### Scenario: Line numbers and white canvas
- **WHEN** the editor mounts with the Monaco surface
- **THEN** a left gutter with line numbers is visible
- **AND** the editor's drawing canvas background is `#ffffff` (verified by Monaco's `editor.background` theme color), even when the surrounding panel uses `bg-card` (grey)

#### Scenario: Toggle to plain editor
- **WHEN** the user clicks the "Plain editor" toolbar toggle
- **THEN** the Monaco surface unmounts and a native `<textarea>` (monospace font, no syntax highlighting) renders in its place, prefilled with the same content
- **AND** `localStorage['memon:readme-editor:plain']` is set to `'1'`
- **AND** subsequent opens of the editor (in this browser) default to the plain surface until the toggle is flipped back

#### Scenario: Copy markdown succeeds
- **WHEN** the user clicks the "Copy markdown" button and `navigator.clipboard.writeText` resolves
- **THEN** the current editor content is on the clipboard
- **AND** a success toast `Copied · README markdown` is shown

#### Scenario: Copy markdown fallback when clipboard blocked
- **WHEN** the user clicks "Copy markdown" and `navigator.clipboard.writeText` rejects (insecure context, permission denied, etc.)
- **THEN** the editor selects all text in the active surface (Monaco `select all` action or `<textarea>.select()`)
- **AND** a `Clipboard blocked — please copy manually` toast is shown

#### Scenario: Monaco import failure auto-fallback
- **WHEN** the dynamic import of `@monaco-editor/react` rejects (e.g., chunk fetch fails)
- **THEN** the editor surface falls back to the plain `<textarea>`
- **AND** a `Editor failed to load — using plain text fallback` toast is shown
- **AND** `localStorage['memon:readme-editor:plain']` is NOT modified (the user's preference is preserved for the next session)

### Requirement: Desktop side-panel layout for the README editor

On viewports with `min-width: 1024px` (the `lg` Tailwind breakpoint), the README editor SHALL render as a right-side resizable panel of the experiment detail page rather than a `<Dialog>` modal. The detail page body SHALL flow in the remaining left column. The panel SHALL be controlled via a React Context (`ReadmeEditorContext`) shared with the `Edit README` button.

The `Edit README` button on desktop SHALL toggle the panel's visibility (open ↔ close) rather than opening a modal. Closing the panel via its close button SHALL also flip the button back to its closed state via the same context.

The two-pane layout SHALL have **isolated vertical scroll**: scrolling the left content column SHALL NOT scroll the panel, and vice versa. There is no page-level (window) scroll on the experiment detail route when the panel is open — instead, the row is pinned to the available viewport height (viewport minus AppBar) and each pane has its own internal `overflow-y: auto`. Sticky-positioning the panel against the document scroll is explicitly NOT acceptable: that approach causes the panel toolbar to slide under the AppBar and creates the appearance of the top row "scrolling away" when the user scrolls the left content.

#### Scenario: Open editor on desktop
- **WHEN** the user is on `/p/<project>/<experimentId>` at viewport width ≥1024px and clicks `Edit README`
- **THEN** a right-side panel slides in (no `<Dialog>` is mounted), occupying `clamp(320px, persistedWidth ?? 50vw, 50vw)` of the viewport width
- **AND** the detail page body remains visible in the left column

#### Scenario: Open editor on tablet
- **WHEN** the user is on the detail page at viewport width 768–1023px and clicks `Edit README`
- **THEN** a full-screen `<Dialog>` opens containing the editor (the side panel is NOT used)

#### Scenario: Open editor on mobile
- **WHEN** the user is on the detail page at viewport width <768px and clicks `Edit README`
- **THEN** a full-screen `<Dialog>` opens containing the editor (same as tablet)

#### Scenario: Switching from desktop to mobile mid-edit
- **WHEN** the editor is open as a desktop side panel and the viewport is resized below 1024px (e.g., DevTools, window shrink)
- **THEN** the side panel unmounts and the editor re-mounts inside a `<Dialog>`, preserving the current `content` state and dirty status (no draft data lost)

#### Scenario: Scroll isolation between panes
- **WHEN** the panel is open and the user scrolls the left content column (e.g., past the section cards)
- **THEN** the panel's vertical scroll position SHALL NOT change
- **AND** the panel's toolbar (top row) SHALL remain fully visible at the top of the panel, NOT pushed under the global AppBar

#### Scenario: No window scrollbar when panel is open on desktop
- **WHEN** the panel is open at viewport ≥1024px and the detail page content overflows
- **THEN** the document/window itself SHALL NOT have a vertical scrollbar
- **AND** the overflow scrollbar appears on the left content column (its own internal `overflow-y: auto`)

### Requirement: Desktop side panel collapse, expand, and resize

The desktop side panel SHALL support three layout states:

1. **Expanded**: full panel with editor, toolbar, and a left-edge drag handle for resizing.
2. **Collapsed**: panel collapses to a 32px-wide vertical handle showing a vertical "Edit README" label; clicking the handle re-expands the panel.
3. **Closed**: panel is fully unmounted (the `Edit README` button reopens it from scratch).

The expanded width SHALL be drag-resizable from the left edge of the panel. The drag handle SHALL be at least 8px wide (so it is grabbable from either side of the visible panel border) and SHALL provide a clear visible affordance on hover/active — a colored vertical bar (e.g., the `--primary` token) that fades in on `hover` and stays visible while the user is actively dragging. The handle's host element (the `<aside>`) MUST establish a positioning context (`position: relative`) so the handle's `absolute` positioning resolves to the panel itself, not an unrelated ancestor.

The width (px) SHALL persist to `localStorage` under key `memon:readme-editor:width`. On open, the panel SHALL read this key and clamp to `[320, 0.5 * window.innerWidth]`. The collapsed/expanded state SHALL persist in the same `ReadmeEditorContext` for the lifetime of the page.

#### Scenario: Collapse the panel
- **WHEN** the user clicks the collapse button (≫) in the panel toolbar on desktop
- **THEN** the panel animates to 32px width
- **AND** a vertical "Edit README" label and an expand affordance (≪) remain clickable on the collapsed handle

#### Scenario: Expand from collapsed
- **WHEN** the user clicks anywhere on the collapsed handle
- **THEN** the panel animates back to its previous expanded width (or `clamp(320px, persistedWidth, 50vw)` if no previous width)

#### Scenario: Resize by dragging
- **WHEN** the user mousedowns on the panel's left-edge drag handle, drags horizontally, and releases
- **THEN** the panel width updates live during the drag
- **AND** on mouseup the new width (clamped to `[320, 0.5 * window.innerWidth]`) is written to `localStorage['memon:readme-editor:width']`
- **AND** during the drag, the document body has `cursor: col-resize` and `user-select: none` applied to prevent accidental text selection

#### Scenario: Drag handle has a discoverable hover affordance
- **WHEN** the user hovers over the panel's left-edge drag handle
- **THEN** a colored vertical bar (using the `--primary` color token) becomes visible along the panel's border line
- **AND** the bar remains visible throughout an active drag, then fades back to invisible on mouseup or pointer-leave
- **AND** the cursor is `col-resize` whenever the pointer is within ~4px of the panel border (the 8px-wide handle straddles the border)

#### Scenario: Restore width on next open
- **WHEN** the panel was previously resized to 480px and the user closes and re-opens it
- **THEN** the new panel mounts at 480px (clamped to viewport)

#### Scenario: Width clamps to viewport on small windows
- **WHEN** `localStorage['memon:readme-editor:width']` is `900` and `window.innerWidth` is `1280`
- **THEN** the panel renders at `min(900, 0.5 * 1280) = 640px`

### Requirement: Conflict resolution dialog

When `PUT /api/readme` returns 409, the editor modal SHALL transition into a conflict view rendering the user's draft on the left and the server's current content on the right, using `react-diff-viewer-continued`. The user SHALL have three options: `Keep my changes (overwrite)`, `Discard mine (use disk)`, `Cancel`.

#### Scenario: Keep my changes
- **WHEN** the user clicks `Keep my changes`
- **THEN** the page re-issues `PUT /api/readme` carrying the **current on-disk mtime** (received in the 409 body) and the user's draft content; on success, the modal closes

#### Scenario: Discard mine
- **WHEN** the user clicks `Discard mine`
- **THEN** the editor's content is replaced with the server's current content, the conflict view is dismissed, and the editor returns to the normal edit mode (so the user can keep editing on top of the latest disk state)

#### Scenario: Cancel
- **WHEN** the user clicks `Cancel`
- **THEN** the conflict view is dismissed but the editor remains open with the user's draft intact (no save attempted, no toast)

### Requirement: localStorage draft autosave

While the editor modal is open, the editor content SHALL be persisted to `localStorage` with key pattern `memon:draft:<absolute file path>:<mtime opened>`. Persistence SHALL debounce keystrokes by ~500ms.

#### Scenario: Continuous edits persist
- **WHEN** the user types in the editor for 5 seconds, then closes the browser tab without saving
- **THEN** the latest content (typed > 500ms before tab close) is in localStorage under the matching key

#### Scenario: Storage quota errors
- **WHEN** the localStorage write throws `QuotaExceededError`
- **THEN** the page shows a `toast.error('Draft autosave failed (storage full)')` and continues to function (in-memory state still intact)

### Requirement: Draft recovery prompt on editor open

When the user opens the editor for a path that already has a localStorage draft, the editor SHALL check the on-disk mtime against the draft's key:
- If they match (no external write occurred): SHOW a prompt `You have an unsaved draft from N minutes ago — Restore / Discard from disk`
- If the on-disk mtime is newer (external write occurred): silently discard the draft and inform via inline banner `Disk content has changed since your last edit`

#### Scenario: Restore draft
- **WHEN** the user clicks `Restore`
- **THEN** the editor opens with the draft content, and `expectedMtime` is set to the draft's key mtime (so save attempts will trigger the conflict view if disk has since changed)

#### Scenario: Discard from disk
- **WHEN** the user clicks `Discard from disk`
- **THEN** the editor opens with the current on-disk content, and the matching localStorage key is deleted

#### Scenario: Skip recovery for tiny drafts
- **WHEN** a draft exists but its content differs from disk by fewer than 5 characters (essentially noise)
- **THEN** the recovery prompt is NOT shown and the draft is silently deleted

### Requirement: 7-day stale draft cleanup

On editor open, the page SHALL scan all `memon:draft:*` keys and delete entries whose `savedAt` is older than 7 days.

#### Scenario: Old draft cleaned
- **WHEN** the user opens any editor and `localStorage` contains a draft with `savedAt = 8 days ago`
- **THEN** that key is deleted before the recovery prompt logic runs

### Requirement: Warnings card draft autosave parity

The Warnings card's per-row Note edits and the in-progress Add-warning form contents SHALL be persisted to `localStorage` under key patterns parallel to the README editor's draft scheme:

- Pending row Note edits: `memon:warning-note-draft:<absolute README path>:<rowId>:<mtime opened>` storing the current textarea value, debounced ~500ms.
- Pending Add-warning form: `memon:warning-add-draft:<absolute README path>:<mtime opened>` storing `{category, message}`, debounced ~500ms.

Both key families SHALL participate in the existing 7-day stale draft cleanup (`memon:draft:*` glob is extended or paralleled to also match `memon:warning-*-draft:*`). On Warnings card open, drafts SHALL be restored if they correspond to the current `mtime`; otherwise they SHALL be silently discarded.

#### Scenario: Note edit autosaves while typing
- **WHEN** the user starts editing a Note cell on a RESOLVED row, types for 5 seconds, then closes the tab without submitting
- **THEN** the latest content (typed > 500ms before close) is in localStorage under `memon:warning-note-draft:<path>:<rowId>:<mtime>`

#### Scenario: Add-warning form autosaves
- **WHEN** the user opens the Add-warning form, picks a category, types a message, and closes the tab without submitting
- **THEN** the partial `{category, message}` is in localStorage under `memon:warning-add-draft:<path>:<mtime>`

#### Scenario: Stale warning drafts cleaned with the existing sweep
- **WHEN** the user opens any editor or Warnings card and `localStorage` contains a `memon:warning-*-draft:*` key with `savedAt > 7 days ago`
- **THEN** that key is deleted as part of the same 7-day cleanup sweep that handles README drafts

### Requirement: Warnings card uses the conflict-resolution dialog

When a Warnings card write returns `409 CONFLICT`, the existing README conflict-resolution dialog SHALL be reused (or a parallel dialog with identical UX). The dialog SHALL show the user's pending change (the row they were resolving / the form they were submitting) alongside the current server state, and SHALL offer the same "discard mine / replay mine on top of server's" choices.

The dialog SHALL preserve the pending edit as a draft (under the localStorage keys above) until the user explicitly discards it.

#### Scenario: Resolve hits CONFLICT, dialog opens, user replays
- **GIVEN** an OPEN warning row with the user mid-resolve at mtime M0
- **WHEN** the resolve PATCH returns 409 because mtime advanced to M1 (with an unrelated note edit on a different row)
- **THEN** the conflict dialog opens, shows both states, and on "replay mine" the resolve is re-attempted with `expectedMtime=M1` and the user's note text intact

### Requirement: Add NOTE event from detail page

The detail page SHALL provide a `+ Note` button that opens a small modal with a textarea and a `Submit` button. Submission SHALL `POST /api/journal/append` with `{ project, tag: 'NOTE', body: \`\\\`<id>\\\` <user input>\` }`.

#### Scenario: Append note
- **WHEN** the user types `converged faster than expected` in the modal and clicks `Submit`
- **THEN** the JOURNAL.md gains a new `[NOTE]` event line with the experiment's id backticked and the user's text appended, and a success toast appears

#### Scenario: Cancel note
- **WHEN** the user closes the modal without submitting
- **THEN** no network request is made and no event is appended

### Requirement: Add NOTE / REQUEST from journal page

The journal page SHALL provide a `+ Add` control that opens a modal letting the user pick a tag (`NOTE` or `REQUEST`) and enter free-form body. Submission SHALL `POST /api/journal/append` with the chosen tag.

#### Scenario: Append request
- **WHEN** the user picks `REQUEST` and types `please summarize experiments related to H0007`, then submits
- **THEN** a new `[REQUEST]` event is appended to JOURNAL.md and the timeline view reflects it (after the next SSE event or query refetch)

### Requirement: Create experiment from web UI

The list page SHALL provide a `+ New experiment` button that opens a modal with `name` (required) and `project` (defaulting to current; selectable when multiple projects are configured) inputs. Submission SHALL `POST /api/experiments` with `{ name, project }`. The backend SHALL run the same scaffolding logic as `memon new` (create directory, write README + run.sh templates, append `[CREATE]` event), then return `{ id, path, project }`.

#### Scenario: Create and navigate
- **WHEN** the user enters `attn-overlap` for project `project-a` and clicks `Create`
- **THEN** a new directory `<project-a-root>/logs/attn-overlap-<yymmdd>-<hhmmss>/` is created with README.md + run.sh, a `[CREATE]` event is appended to JOURNAL.md, and the user is navigated to the new experiment's detail page

#### Scenario: Name collision in same second
- **WHEN** the same name is submitted within a one-second window producing a directory that already exists
- **THEN** the backend returns 409 and the modal shows an inline error `An experiment with that name already exists this second; try again`

### Requirement: POST /api/experiments backend route

The backend SHALL expose `POST /api/experiments` accepting `{ name: string, project?: string }`. Implementation SHALL share core scaffolding logic with the CLI's `memon new` command (extracted to `@memon/core`).

#### Scenario: Successful creation
- **WHEN** a valid request is received
- **THEN** the response is 200 with `{ created: { id, path, project } }` and the runtime ExperimentIndex is updated immediately (so the next `/api/experiments` GET reflects the new row)

#### Scenario: Unknown project
- **WHEN** the body specifies a `project` that is not in the resolved config
- **THEN** the response is 404 with `{ error: { code: 'NOT_FOUND', message: 'project "..." not configured' } }`

#### Scenario: Default project resolution
- **WHEN** the body omits `project`
- **THEN** the backend defaults to the first project in the resolved config

