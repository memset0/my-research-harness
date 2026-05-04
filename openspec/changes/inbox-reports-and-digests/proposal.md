## Why

`memon-write-report` and `memon-digest-journal` skills already write
markdown artifacts to `<projectRoot>/docs/reports/R<NNNN>-<slug>.md` and
`<projectRoot>/docs/digests/D<NNNN>-<YYYY-MM-DD>.md` respectively. These
files are project-level memory: a report distills a theme across runs,
a digest snapshots a date range from `JOURNAL.md`. Today the only way
for a user to read them is `cat`, `code <file>`, or scrolling through
the filesystem. The dashboard exposes experiments / hypotheses / journal
but not these two artifact families.

That gap is annoying in two ways:

1. The skill that wrote the artifact has no link to surface in its output
   the way `[H0001]` links to a hypothesis page — the file just exists
   in `docs/`.
2. Reading on mobile (or quickly skimming a stack of digests) requires
   shelling into the cluster, opening a terminal, and `cat`-ing — a
   broken loop for the "review your week" use case.

The viewer fits naturally next to the existing per-project tabs. Reports
are theme-keyed (slug), digests are date-keyed; the user explicitly
wants them as **two separate AppBar tabs**, each its own inbox.

## What Changes

### Backend (read + write)

- **New API: `GET /api/reports?project=<name>`** — list all reports
  for the project. Returns
  `{ reports: Array<{ id: string, slug: string, path: string, mtime: number, title: string | null }> }`,
  sorted by id desc. Reads from `<projectRoot>/docs/reports/`, glob-matches
  `R<NNNN>-<slug>.md` filenames, parses the first H1 heading as `title`
  (or null when absent). No frontmatter assumed in v1 — reports are
  plain markdown.
- **New API: `GET /api/reports/[id]?project=<name>`** — read a single
  report. Returns
  `{ id, slug, path, mtime, hash: string, content: string }`. The `hash`
  is sha256 of the file content (used for optimistic locking on writes,
  matching the README write flow).
- **New API: `PUT /api/reports/[id]?project=<name>`** — write a report.
  Body: `{ content: string, expectedMtime: number, expectedHash: string }`.
  Same mtime+hash optimistic locking semantics as `/api/readme`. Atomic
  rename through a sibling `.tmp.<random>` file. Returns
  `{ ok, mtime, hash }` on success or `{ error: { code: 'CONFLICT', ... } }`
  with the current mtime/hash on stale write.
- **New API: same shape under `/api/digests`** for the digest variant.
  Identical contract; only the source directory and filename pattern
  differ (`docs/digests/`, `D<NNNN>-<YYYY-MM-DD>.md`).
- **Path safety** for both routes: any path constructed from the project
  root + filename SHALL go through `assertWithinProjectRoots()` (per
  CLAUDE.md hard rule). Filenames are validated against the `R<NNNN>-`
  / `D<NNNN>-` prefix regex; non-matching filenames are rejected as
  `BAD_REQUEST`.
- **Polling**: the runtime's `Poller` SHALL register every discovered
  report and digest path so external edits (a skill writes a new D-file,
  the user `code`-edits a report on disk) become visible without dev-server
  restart. Same backoff rules as `HYPOTHESES.md` / `JOURNAL.md`.
- **Runtime cache** (`packages/core/src` + `apps/web/lib/runtime.ts`):
  add `reportsCache` and `digestsCache` keyed by project root. Each
  cache holds `{ files: Array<{ id, slug, path, mtime, title }> }` plus
  per-file content lazily loaded on first GET (with mtime-based
  invalidation).

### Frontend — AppBar

- Add two tabs to `apps/web/components/app-bar.tsx`: **Reports**
  (active for `/p/<proj>/reports/...`) and **Digests** (active for
  `/p/<proj>/digests/...`). Both render to the right of Journal in the
  existing tab order: Experiments / Hypotheses / Journal / Reports / Digests.

### Frontend — Routes

- New route: `apps/web/app/p/[project]/reports/page.tsx` — landing,
  shows the inbox layout. When no report is selected (or none exists),
  the right-hand pane shows an empty-state.
- New route: `apps/web/app/p/[project]/reports/[id]/page.tsx` — same
  inbox shell, but with the selected report rendered in the right pane.
- Mirror routes under `digests/` (identical shell with id pattern
  `D<NNNN>-<YYYY-MM-DD>`).

### Frontend — Desktop Inbox layout

Layout grid for desktop (≥ md breakpoint):

- **2-column read mode** (default):
  - Left rail (~280–320 px): scrollable file list. Each item is one
    line with id (mono), title (truncated, soft-muted), and date /
    slug fingerprint. Active item highlighted.
  - Right pane (flex-1): rendered markdown. Top of pane has an
    **Edit** button.
- **3-column edit mode** (toggled by the Edit button):
  - Left rail unchanged.
  - Middle pane: rendered markdown (live preview).
  - Right pane: Monaco editor, ~440 px wide, full height.
  - Save button in editor toolbar; mtime+hash optimistic locking via
    the new PUT endpoint. On `CONFLICT` we surface a "stale snapshot"
    toast with a Reload action (same UX as `<EditReadmeButton>`).
  - Closing the editor returns to 2-column read mode.

The shell component SHALL be reused between Reports and Digests routes —
they only differ by the data-source key (`reports` vs `digests`) and
the empty-state copy.

### Frontend — Mobile (< md)

- Default: when the user navigates to `/p/<proj>/reports`, the page
  renders the rendered-markdown of the most-recent report in single
  column (no list rail).
- A floating action button (FAB) anchored bottom-right opens a Drawer
  from the right (using the shadcn `Sheet` primitive set to
  `side="right"`). The drawer contains the same scrollable list; tapping
  an entry navigates to that report's detail URL and closes the drawer.
- Tapping the page-level Edit button takes over the full viewport with
  Monaco (the recommended option — closes the rendered view; Save or
  Cancel returns). Use the shadcn `Sheet` primitive set to `side="bottom"`
  with `h-[100svh]` to slide up over everything.

### shadcn primitives

- Use existing `Sheet` for the mobile drawer + full-screen editor.
- Use existing `Button`, `Card`, `Input`, `Tooltip` as needed.
- Reuse `<ReadmeMonaco>` (the Monaco wrapper from
  `apps/web/components/readme-monaco.tsx`) — its theme + token wiring
  is already done. Pass `language="markdown"`.
- Reuse `<Markdown>` for the rendered view.

## Capabilities

### New Capabilities

- `inbox-viewer`: Per-project file-list-on-the-left, rendered-markdown-on-
  the-right viewing pattern with click-to-edit Monaco, plus its mobile
  responsive variant. The pattern is generic enough that future capabilities
  (e.g. an "agents handoff transcripts" viewer) could reuse the spec rather
  than re-derive it.
- `reports-store`: The on-disk shape, naming convention, parse rules, API
  contract, and polling semantics for `<projectRoot>/docs/reports/`.
- `digests-store`: Same, for `<projectRoot>/docs/digests/`. Listed
  separately because the filename pattern, sort key, and the implicit
  cursor-advance semantics (digests advance `last_digest_at`, reports
  do not) differ.

### Modified Capabilities

- `web-dashboard`: Add the two new AppBar tabs and define the reports /
  digests inbox routes alongside the existing experiments / hypotheses /
  journal routes.
- `web-layout`: Document the inbox layout as a reusable shell variant
  (alongside the existing `experiments` and `journal` page shells).
- `runtime-cache`: Add `reportsCache` and `digestsCache` to the warmup
  + Poller integration.

## Impact

- **Code:**
  - `packages/core/src/`: parsers + types for `R<NNNN>-<slug>.md` /
    `D<NNNN>-<YYYY-MM-DD>.md` filenames, title-extraction helper, sha256
    helper if not already present.
  - `apps/web/lib/runtime.ts`: new caches, new Poller registrations.
  - `apps/web/lib/runtime/file-cache.ts`: extend or duplicate to support
    a directory-glob cache (`reportsCache` is per-directory, not per-fixed-path).
  - `apps/web/lib/api.ts`: client-side fetch wrappers + types.
  - `apps/web/lib/server/data.ts`: `getReportsList`, `getReport`,
    `getDigestsList`, `getDigest` SSR fetchers.
  - `apps/web/app/api/reports/route.ts`, `apps/web/app/api/reports/[id]/route.ts`,
    and the digest mirrors.
  - `apps/web/app/p/[project]/reports/page.tsx`, `.../reports/[id]/page.tsx`,
    digest mirrors, plus `apps/web/components/inbox-shell.tsx` (the
    shared layout component) and `apps/web/components/inbox-editor.tsx`
    (the Monaco wrapper for inline edits).
  - `apps/web/components/app-bar.tsx`: two new tabs.
- **Specs:** `inbox-viewer`, `reports-store`, `digests-store`, plus
  modifications to `web-dashboard`, `web-layout`, `runtime-cache`.
- **Tests:** API route tests for read + write of both reports and
  digests (mtime conflict, path-safety violation, missing dir, malformed
  filename); a snapshot/render test for `<InboxShell>` covering empty,
  one-item, many-items states.
- **Mock fixtures:** add at least 1 report + 2 digests under
  `mock/project-a/docs/` so the inbox is non-empty in dev.
- **Backward compat:** zero. New endpoints, new routes, new tabs. No
  existing route or API changes in shape.
- **Out of scope:** creating new reports/digests from the dashboard
  (that's still the skill's job — `memon-write-report` /
  `memon-digest-journal`); only edit-existing for now. Search across
  reports/digests; tag-based filtering; cross-linking from
  `[D0042]` / `[R0007]` mentions in journal/hypotheses to the inbox.
  All of those are sensible follow-ups.
