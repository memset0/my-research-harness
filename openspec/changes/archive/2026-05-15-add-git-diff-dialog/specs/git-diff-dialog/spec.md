## ADDED Requirements

### Requirement: Footer git-pill is clickable; opens the git-diff dialog

The project-footer git-pill SHALL be wrapped in a click target that
opens a `<GitDiffDialog />` for the current project. The pill
component lives at `apps/web/components/git-status-pill.tsx`
(variant `footer`). The existing hover-tooltip behaviour SHALL be
preserved — hover shows the tooltip, click opens the dialog; the
two interactions MUST NOT block each other.

The sidebar's compact pill SHALL remain non-clickable; its parent
`Collapsible` row already toggles on click, and v1 does not add a
second click target there.

#### Scenario: Click opens dialog
- **WHEN** the user clicks the footer pill on `/p/project-a`
- **THEN** a shadcn `<Dialog>` opens with `data-slot="git-diff-
  dialog"` and the dialog title contains `project-a`

#### Scenario: Hover still shows tooltip
- **WHEN** the user hovers (without clicking) the footer pill on
  `/p/project-a`
- **THEN** the same Radix tooltip as before this change appears
  with the branch + counts + upstream info

#### Scenario: Sidebar pill remains non-clickable
- **WHEN** the user clicks the compact pill inside a project row in
  the sidebar
- **THEN** the click is consumed by the existing Collapsible trigger
  (expanding / collapsing the project's experiments) and NO dialog
  opens

### Requirement: `<GitDiffDialog />` content structure

`apps/web/components/git-diff-dialog.tsx` SHALL export a client
component that mounts a shadcn Dialog. The Dialog's content
container SHALL have width `min(90vw, 1600px)` and a maximum height
of `90vh`. It MUST override BOTH the base-variant max-width AND the
responsive `sm:max-w-sm` that shadcn's `<DialogContent />` applies
by default — implementation passes `max-w-none sm:max-w-none`
alongside the explicit width. Wide viewports get the full 1600px;
narrow viewports gracefully shrink to 90% of the viewport.

The Dialog content SHALL include:

1. **Header summary line**: branch (or `(<short-sha>)` when
   detached), upstream + `↑a ↓b` when present, and the same staged /
   unstaged / untracked counts the footer pill shows.
2. **Three sections, always rendered in this order**:
   `Staged (N)` → `Unstaged (N)` → `Untracked (N)`. Sections
   themselves are NOT collapsible. An empty section renders with
   `(none)` placeholder text — users SHALL be able to confirm
   "nothing staged" at a glance.
3. **File rows** inside each section: status indicator + repo-
   relative path (monospace) + chevron. Rows are individually
   collapsible. The default state is COLLAPSED.
4. **Toolbar**: at the top of the dialog body, a view-mode toggle
   (split / inline) wired to `useDiffViewMode()` (see "diff view
   mode persistence" requirement below).

When the dialog opens, the file lists SHALL be fetched lazily via
TanStack Query (key `['git-status-files', project]`). While loading,
the three sections SHALL show a skeleton placeholder instead of
mid-render `(none)`.

#### Scenario: Dialog open fetches lists once
- **GIVEN** the user has not yet opened the dialog
- **WHEN** they click the footer pill for `project-a`
- **THEN** exactly one GET to `/api/projects/project-a/git-status/
  files` is fired; the dialog renders Skeleton placeholders
  initially, then re-renders with the resolved counts and rows

#### Scenario: Empty section renders explicit "(none)"
- **GIVEN** the project has staged changes but no untracked files
- **WHEN** the dialog renders
- **THEN** the `Untracked (0)` section is visible with the text
  `(none)` inside it (NOT entirely hidden)

#### Scenario: File rows are collapsed by default
- **GIVEN** the dialog has rendered with N>0 unstaged files
- **WHEN** the dialog first appears
- **THEN** none of the file rows have their diff body mounted; the
  DOM contains no `<FileDiff />` instances until the user clicks
  the row's chevron

#### Scenario: Dialog width is `min(90vw, 1600px)`
- **WHEN** the dialog renders
- **THEN** the `DialogContent` element has Tailwind classes
  `w-[min(90vw,1600px)]`, `max-w-none`, AND `sm:max-w-none` so the
  content reaches 1600px on wide viewports and shrinks to 90% of
  the viewport on narrow ones (the `sm:` variant is REQUIRED
  because shadcn's default applies `sm:max-w-sm` which would
  otherwise cap the dialog at 24rem on any viewport ≥ 640px)

### Requirement: Expanding a row fetches and renders its diff

Clicking a file row SHALL toggle its expansion. When a row is
expanded for the first time, the dialog SHALL fetch
`GET /api/projects/:project/git-diff?path=<repoRel>&side=<staged|
unstaged|untracked>` with TanStack Query (key `['git-diff',
project, path, side]`, `staleTime: Infinity` within the dialog's
lifetime — re-opening the dialog DOES re-fetch).

While the request is in flight, `<FileDiff loading />` SHALL be
rendered. On success, `<FileDiff oldContent={...} newContent={...} />`
SHALL render the diff. On a `skipReason` response,
`<FileDiff skipReason={...} />` SHALL render the placeholder.

Collapsing a row SHALL unmount the diff body. Re-expanding does NOT
re-fetch within the same dialog session (the TanStack cache is hit).

#### Scenario: Expand triggers fetch + render
- **GIVEN** the dialog is open and showing `app/page.tsx` under
  Unstaged
- **WHEN** the user clicks the row
- **THEN** the dialog issues `GET /api/projects/<p>/git-diff?path=
  app/page.tsx&side=unstaged`; while loading the row shows a
  skeleton; once resolved the row body shows a diff rendered by
  `react-diff-viewer-continued`

#### Scenario: Collapse + re-expand reuses cache
- **GIVEN** a row was previously expanded and its diff fetched
- **WHEN** the user collapses the row and then expands it again
  within the same dialog session
- **THEN** NO new HTTP request fires; the diff renders from
  TanStack's cache

#### Scenario: Re-opening the dialog re-fetches
- **GIVEN** a dialog was opened, a row was expanded, then the
  dialog was closed
- **WHEN** the user re-opens the dialog and expands the same row
- **THEN** a fresh `GET /api/projects/<p>/git-diff?...` request
  fires (cache key is dialog-session-scoped)

### Requirement: Reusable `<FileDiff />` component

`apps/web/components/file-diff.tsx` SHALL export a stateless
component with the props:

```ts
interface FileDiffProps {
  filename: string
  oldFilename?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'
        | 'untracked' | 'conflict' | 'typechange'
  oldContent: string | null
  newContent: string | null
  skipReason?: 'too-large' | 'binary' | 'conflict' | null
  loading?: boolean
  errorMessage?: string | null
}
```

The component MUST:

- Read the view mode from `useDiffViewMode()` — view mode is NOT a
  prop. Two `<FileDiff />` instances mounted simultaneously MUST
  always render in the same mode.
- When `loading` is `true`: render a skeleton block sized to
  approximate diff content height.
- When `errorMessage` is non-null: render the message in
  `text-destructive`.
- When `skipReason` is non-null: render a single-line placeholder
  identifying the reason (e.g. "binary file", "file too large").
- Otherwise: mount `react-diff-viewer-continued` with `oldValue`,
  `newValue`, and `splitView` set from the hook.
- Normalize line endings on both sides — CRLF → LF — to avoid
  spurious all-line diffs on Windows-edited files.
- Fill the available width without introducing a horizontal scroll
  on the diff itself. In split mode the two sides MUST each occupy
  exactly 50% of the available width; in inline mode the single
  column MUST occupy 100%. Long lines wrap at word boundaries
  (fallback: anywhere) so the diff cannot push the container into
  horizontal scroll. Implementation: pass a `styles` override to
  `react-diff-viewer-continued` with `diffContainer.width: 100%`
  AND `tableLayout: 'fixed'`, plus per-column / per-cell
  `width: 50%` + `minWidth: 0`, plus `contentText.whiteSpace:
  pre-wrap` + `wordBreak: break-word` + `overflowWrap: anywhere`.
- The outer wrapper element with `data-slot="file-diff"` MUST NOT
  set `overflow-x` to a scrollable value. Vertical scrolling for
  the dialog as a whole is the parent dialog's responsibility.

The component SHALL NOT fetch data itself; callers pass already-
resolved content. This keeps the component reusable for the
upcoming commit-history change without coupling to the working-tree
endpoint.

#### Scenario: View mode comes from the shared hook
- **GIVEN** two `<FileDiff />` instances are mounted in the same
  dialog with `oldContent` / `newContent` set, and
  `useDiffViewMode()` resolves to `'inline'`
- **WHEN** they render
- **THEN** both instances render in inline (single-column) mode
  (i.e. the underlying RDV is called with `splitView: false`)

#### Scenario: skipReason short-circuits the diff render
- **GIVEN** a `<FileDiff skipReason="too-large" />` with `oldContent`
  / `newContent` set to `null`
- **WHEN** it renders
- **THEN** the markup contains a placeholder mentioning "too large"
  and `react-diff-viewer-continued` is NOT mounted

#### Scenario: CRLF normalised on both sides
- **GIVEN** `oldContent` ends every line with `\r\n` and `newContent`
  with `\n`
- **WHEN** `<FileDiff />` renders
- **THEN** the diff rendered by RDV shows NO whole-file line-ending
  delta (both sides are normalised to LF before being passed to
  RDV)

#### Scenario: Split-view fills the available width 50/50
- **GIVEN** `<FileDiff oldContent="..." newContent="..." />` is
  mounted inside the git-diff dialog AND `useDiffViewMode()`
  resolves to `'split'`
- **WHEN** the component renders
- **THEN** the RDV instance receives a `styles` override that
  includes `diffContainer.width: '100%'`, `tableLayout: 'fixed'`,
  and per-column `width: '50%'`, so each side occupies exactly
  half of the dialog's content area and very long lines wrap
  inside their column instead of overflowing it

### Requirement: Diff view mode persistence across all instances

`apps/web/lib/use-diff-view-mode.ts` SHALL export
`useDiffViewMode()` returning a `[mode, setMode]` tuple where
`mode: 'split' | 'inline'`.

Persistence:

- Mode SHALL be persisted in `localStorage` under the key
  `memon:diff-view:mode`. Values `'split'` and `'inline'` are valid;
  anything else falls back to the default `'split'`.
- Calling `setMode(next)` SHALL:
  1. Write `next` to `localStorage`.
  2. Dispatch a `CustomEvent('memon:diff-view-mode-change', {
     detail: next })` on `window` so other mounted instances within
     the same tab re-render immediately.
- Every `useDiffViewMode()` instance SHALL subscribe to BOTH:
  - the custom in-tab event above
  - the native `storage` event (so changes from a different tab
    propagate)
- SSR-safe: when `typeof window === 'undefined'`, the hook SHALL
  return the default mode and a no-op setter rather than throwing.

#### Scenario: Setting mode in one component updates another live
- **GIVEN** two `<FileDiff />` instances are mounted in the dialog
  (e.g. two expanded file rows)
- **WHEN** the user clicks the split/inline toggle in the dialog
  toolbar (which calls `setMode('inline')`)
- **THEN** both `<FileDiff />` instances re-render in inline mode
  within a single React commit (no full reload required)

#### Scenario: Cross-tab synchronization via storage event
- **GIVEN** the dialog is open in tab A and a separate dialog or
  diff-view is open in tab B
- **WHEN** tab A toggles the mode to `'inline'`
- **THEN** tab B receives the `storage` event and its mounted
  `<FileDiff />` instances re-render in inline mode

#### Scenario: Initial default is split
- **GIVEN** localStorage has no `memon:diff-view:mode` key
- **WHEN** any `<FileDiff />` first mounts
- **THEN** it renders in split (side-by-side) mode

### Requirement: 1024 KB size cap and binary detection

`@memon/core`'s diff readers SHALL enforce a
`MAX_DIFF_BYTES = 1024 * 1024` cap on both sides of any diff, and
SHALL surface binary content as a non-error skip reason rather than
attempting to render bytes. The cap applies to BOTH the
old side and the new side of a diff. If either side's byte length
exceeds the cap, the diff payload SHALL be returned as
`{ ok: false, skipReason: 'too-large', sizeBytes, maxBytes, side }`
where `side` identifies which side overflowed.

Binary detection: scan the first 8 KB of each side's bytes for any
`0x00` byte. Any match → return
`{ ok: false, skipReason: 'binary' }`. If no null byte but the bytes
fail UTF-8 validation (`Buffer.isUtf8(...) === false`), also return
`{ ok: false, skipReason: 'binary' }`.

The `MAX_DIFF_BYTES` constant SHALL live in
`packages/core/src/git/files.ts` as a non-exported (or `export const`
for tests) value. It is NOT user-configurable in v1.

#### Scenario: Old side too large
- **GIVEN** a file whose `HEAD` blob is 1.5 MB
- **WHEN** the diff payload is computed for `side=staged`
- **THEN** the response is `{ ok: false, skipReason: 'too-large',
  side: 'old', sizeBytes: 1572864, maxBytes: 1048576 }`

#### Scenario: New side too large
- **GIVEN** an untracked working-tree file that is 1.2 MB
- **WHEN** the diff payload is computed for `side=untracked`
- **THEN** the response is `{ ok: false, skipReason: 'too-large',
  side: 'new', ... }`

#### Scenario: Binary file detected via null byte
- **GIVEN** a working-tree file whose first 8 KB contain a `0x00`
- **WHEN** the diff payload is computed for any side
- **THEN** the response is `{ ok: false, skipReason: 'binary' }`

#### Scenario: Non-UTF-8 bytes detected
- **GIVEN** a working-tree file whose bytes are valid Latin-1 but
  invalid UTF-8 (e.g. a stray `0xC0` byte sequence)
- **WHEN** the diff payload is computed
- **THEN** the response is `{ ok: false, skipReason: 'binary' }`

### Requirement: `GET /api/projects/:project/git-diff` endpoint

The web server SHALL expose `GET /api/projects/:project/git-diff?
path=<repo-relative-path>&side=<staged|unstaged|untracked>` returning
JSON.

The route SHALL:

1. Resolve the project name (404 on miss, identical to existing
   route).
2. Enforce viewer scope (403 if viewer + out-of-scope, identical
   to existing route).
3. Validate the `path` query param:
   - MUST be present (400 if missing).
   - MUST NOT contain a `\0` byte (400 otherwise).
   - `path.resolve(project.root, path)` MUST have `project.root +
     path.sep` as a prefix (400 otherwise — escape attempt).
4. Validate the `side` query param: MUST be one of `staged`,
   `unstaged`, `untracked` (400 otherwise).
5. Call the appropriate readers in `@memon/core` and return the
   `GitDiffResponse` payload (200 in all non-validation cases —
   including `skipReason` payloads, which are legitimate results,
   not errors).

#### Scenario: Owner GET for an unstaged text file
- **GIVEN** an owner session and an unstaged text file `app/page.tsx`
  in a registered project
- **WHEN** `GET /api/projects/<p>/git-diff?path=app/page.tsx&side=
  unstaged`
- **THEN** the response is `200 { ok: true, filename: 'app/page.tsx',
  oldContent: '...', newContent: '...', status: 'modified' }`

#### Scenario: Owner GET for an untracked file
- **GIVEN** an untracked file `notes.md`
- **WHEN** `GET /api/projects/<p>/git-diff?path=notes.md&side=
  untracked`
- **THEN** the response is `200 { ok: true, oldContent: null,
  newContent: '...', status: 'untracked' }`

#### Scenario: Path escape attempt
- **GIVEN** an owner session
- **WHEN** `GET /api/projects/<p>/git-diff?path=../../etc/passwd&
  side=unstaged`
- **THEN** the response is `400` (validation rejects the path
  before any reader is invoked)

#### Scenario: Missing or invalid side
- **GIVEN** an owner session
- **WHEN** `GET /api/projects/<p>/git-diff?path=app/page.tsx&side=
  cached` (invalid)
- **THEN** the response is `400`

#### Scenario: Too-large payload returns 200 with skipReason
- **GIVEN** a 2 MB modified file
- **WHEN** `GET /api/projects/<p>/git-diff?path=big.txt&side=
  unstaged`
- **THEN** the response is `200 { ok: false, skipReason: 'too-
  large', side: '...' , sizeBytes: ..., maxBytes: 1048576 }`
