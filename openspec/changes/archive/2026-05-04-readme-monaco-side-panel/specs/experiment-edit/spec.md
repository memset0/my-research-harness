## MODIFIED Requirements

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

## ADDED Requirements

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
