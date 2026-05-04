## Context

Two on-disk artifact families are written by skills today and have no
viewer:

- `<projectRoot>/docs/reports/R<NNNN>-<slug>.md` (theme-keyed, by
  `memon-write-report`)
- `<projectRoot>/docs/digests/D<NNNN>-<YYYY-MM-DD>.md` (date-keyed,
  by `memon-digest-journal`)

The dashboard already exposes hypotheses and journal via the same
runtime cache + Poller pattern (`apps/web/lib/runtime/file-cache.ts`),
but `FileCache<T>` is for **fixed paths**: each instance is created with
a known list of files and watches them. Reports and digests are
fundamentally **directory contents** — files come and go; the user
expects a new digest written by a skill to show up without restarting
the dev server.

The existing `<EditReadmeButton>` flow demonstrates the
mtime-+-hash optimistic locking pattern we'll mirror for write. The
existing `<ReadmeMonaco>` component already handles theme + token
plumbing for Monaco; we should reuse it.

UI-wise, three of the existing per-project pages
(`/p/<proj>` experiments, `/p/<proj>/hypotheses`, `/p/<proj>/journal`)
all use a single-column scroll layout. The inbox shell is a new layout
shape (split with a left rail), so a reusable component is justified.

User-confirmed UX choices:

- Reports and digests live as **two separate AppBar tabs** (not a
  unified "Inbox" page).
- Mobile edit mode is **full-screen Monaco takeover**, not an in-page
  bottom drawer.

## Goals / Non-Goals

**Goals:**

- Read + edit reports and digests from the dashboard with the same
  reliability guarantees as the README edit flow (mtime+hash optimistic
  lock; CONFLICT recovery).
- Live reflection of skill-written or `code`-edited files via the
  existing Poller — no manual refresh.
- One reusable `<InboxShell>` so the same component renders both Reports
  and Digests routes; only the data source key differs.
- Desktop 2-/3-column layout; mobile single-column with FAB-opened
  drawer for navigation and full-screen Monaco for editing.

**Non-Goals:**

- Creating new reports/digests from the dashboard. The skills are still
  the only authors; the dashboard is read+edit, not create-or-delete.
- Cross-linking from `[D0042]` / `[R0007]` mentions inside other
  artifacts (journal events, hypotheses bodies, experiment READMEs)
  to the inbox. Useful but separate; tracked as a follow-up.
- Search across reports/digests, tag filtering, or any kind of
  faceted browse. v1 is "scroll the list, click an item, read it."
- A unified "/inbox" page that mixes reports and digests. The user
  explicitly chose two separate tabs.

## Decisions

### D1. Two parallel API namespaces (`/api/reports/*` and `/api/digests/*`) instead of a unified `/api/docs/*`

Reports and digests have different semantics (theme-keyed vs date-keyed,
cursor-advancing vs not, distinct filename regex). Their identifiers
don't overlap: a `R0001` and a `D0001` can both exist in the same project
and they mean unrelated things. A unified `/api/docs?kind=report|digest`
would force the kind into every path-handling check anyway, while
adding a level of indirection for no payoff. Keep them separate; share
implementation via internal helpers (a `DirCache` class — see D2 — and
an internal `readDocFile` / `writeDocFile` pair parameterized by
directory + filename regex).

Alternative considered: shape the PUT body to carry a `kind` field and
serve everything through `/api/docs/[id]`. Rejected because front-end
URLs would lose the type information, complicating route-class auth
bypass logic, sidebar URL matching, and SSR prefetch keys.

### D2. Introduce a `DirCache<T>` primitive for directory-shaped caches

`FileCache<T>` watches a fixed list of paths. We need: watch a
directory, list its contents, parse a subset matching a name regex,
expose `getList()` and `getEntry(id)`. Directory-shaped caching is its
own concern, but small enough to live next to `FileCache` rather than
being a separate package.

Skeleton:

```ts
class DirCache<T> {
  constructor(opts: {
    name: string                          // 'reports' / 'digests'
    dirs: string[]                        // <projectRoot>/docs/reports
    fileNameRegex: RegExp                 // /^R\d{4}-.+\.md$/
    parseFile: (path, content) => T       // returns metadata; full content is reread on demand for editor
    poller: Poller
  })
  warmup(): Promise<void>                 // scandir each dir, parse all matching files
  getList(dir: string): T[]               // return entries for one dir
  getContent(absPath: string): Promise<{ content, mtime, hash }>  // bypass cache; read fresh
  putContent(absPath, content, expectedMtime, expectedHash): Promise<...>
  handlePollChange(path: string): boolean // hook for the shared Poller
}
```

The Poller registers the **directory** itself (we watch the dir's mtime
which advances when files are added/removed) AND every individual matching
file (so edits are observed). On dir-mtime change we re-scandir; on
file-mtime change we refresh that single entry.

Alternative: extend `FileCache<T>` to optionally watch a directory.
Rejected because the contract differs (`get` becomes "give me an entry"
vs "give me the file at this path") and cramming both into one class
muddies it. Keep `FileCache` for fixed paths; introduce `DirCache` for
this use case.

### D3. Title extraction is best-effort, no front-matter assumed

Reports written by `memon-write-report` don't currently have a YAML
frontmatter (digests do — `last_digest_at` lives in JOURNAL but each
digest body is plain markdown). For v1 we extract the **first H1
heading** (`# Title`) as the display title for the inbox list, falling
back to `null` (UI shows just the id+slug) when none exists.

If a future revision of the skills adds frontmatter to reports/digests,
the parser can be extended to prefer a `title:` field. Out of scope here.

### D4. Write flow: same mtime+hash optimistic locking as `/api/readme`

Reuse the pattern: client sends `{ content, expectedMtime, expectedHash }`;
server `stat`s the file, compares mtime AND hash, and either writes
through a `.tmp.<random>` sibling + atomic rename + emits the new
mtime+hash, or returns 409 with the on-disk mtime+hash+content for the
client to merge.

`hash` uses sha1 to match the existing `/api/readme` choice (cheap and
sufficient for "did the bytes change since I read"). `expectedHash` is
optional in the request to keep it backwards-compat with the readme
flow's API signature shape.

### D5. One `<InboxShell>` shared between Reports and Digests

Both views are structurally identical — left rail of items, right pane
for selected item, optional Monaco editor on the right. Generic
component takes:

```tsx
<InboxShell
  kind="reports" | "digests"
  project={project}
  items={items}                    // list metadata
  selectedId={selectedId}          // from URL
  emptyState={<ReportsEmpty />}    // kind-specific copy
/>
```

Internally it manages: which item is shown in the right pane, edit-mode
toggle, mobile FAB+drawer, Monaco mount. Per-kind differences (label
"Reports" vs "Digests", id format hint, empty-copy) are passed in as
props. Avoids 90% duplication.

### D6. Mobile drawer uses shadcn `Sheet` set to `side="right"`

The mobile UX is: a FAB anchored bottom-right, tap → a drawer slides in
from the right with the file list. shadcn ships this primitive
(`<Sheet>` from `radix-ui` collapsibles); no new dep needed.
`SheetTrigger` is the FAB; `SheetContent side="right"` is the drawer.
On selection we call `router.push()` and close the sheet; the URL change
swaps the rendered content.

The FAB itself is a simple `<Button size="icon">` with `lucide-react`
`<List/>` icon, positioned `fixed bottom-6 right-6 z-30 md:hidden`.

### D7. Mobile edit: full-viewport `Sheet` with `side="bottom"` + `h-[100svh]`

Tapping Edit on mobile opens the editor full-screen. Implemented via the
same `Sheet` primitive set to `side="bottom"` and stretched to
`h-[100svh]` so it covers the AppBar too. The sheet content holds the
Monaco component plus a sticky toolbar (Save / Cancel). On Save: PUT,
on success close the sheet and the page re-renders with the fresh
content. On CONFLICT: show the same toast UX as the desktop editor.

`100svh` (small viewport units) is intentional — `100vh` includes the
mobile browser's URL bar in the height calculation, which causes a
visible jump when the bar collapses on scroll. `100svh` is the stable
height. Tailwind v4 supports it natively.

### D8. URL structure: `/p/[project]/(reports|digests)/[id]`

When no item is selected the URL is `/p/<proj>/reports`; when one is
selected it's `/p/<proj>/reports/R0007`. Keeps the inbox shell at one
route and the selected-item state in the path (rather than a query
param) — so that browser back/forward navigates between reports and
URLs are shareable. Same for digests with the `D<NNNN>-<YYYY-MM-DD>`
id pattern.

## Risks / Trade-offs

- **`DirCache` complexity vs reuse.** New primitive adds maintenance
  surface. → Mitigation: keep the API tight, mirror `FileCache`
  semantics where possible, and unit-test it independently of HTTP.
  Revisit if a third use case never materializes.

- **Title extraction with no frontmatter is fragile.** A report whose
  first content is a blockquote or an image will have no detected
  title. → Mitigation: always show id + slug as the primary text;
  title is a soft hint, not a contract.

- **Monaco bundle size.** Already paid by `<ReadmeMonaco>`, but two
  more edit entrypoints potentially load it more often. → Mitigation:
  reuse the same dynamic import / SSR-guard the `ReadmeMonaco` already
  has (`'use client'` + `next/dynamic`).

- **Full-screen mobile editor steals the user's place in the list.**
  When they save / cancel they return to the inbox at the same selected
  item — but the rest of the list scroll position must be preserved.
  → Mitigation: drawer-state independence; saving/closing doesn't
  unmount the underlying inbox tree.

- **Backward compat:** none. New routes, new tabs, new APIs. Reverting
  is a single revert per commit; no data migration.

- **Concurrent skill writes during open editor.** A skill might
  write to a digest while the user is editing it. Optimistic locking
  surfaces the conflict at save time; the user sees a stale snapshot
  toast and reloads. Same as today's README edit flow.

## Migration Plan

1. Land core changes (`DirCache`, types, parsers).
2. Land web backend (`/api/reports/*`, `/api/digests/*`, runtime cache
   integration). Verify by curl against a fixture.
3. Land web UI (`<InboxShell>`, `<InboxEditor>`, the four route files,
   AppBar tabs). Verify by manual smoke at `/p/sparse-fsdp/reports`
   (one existing real report) and the new mock fixtures.
4. Update specs (`inbox-viewer`, `reports-store`, `digests-store`
   added; `web-dashboard`, `web-layout`, `runtime-cache` modified).
5. Validate change clean. Commit.
6. Rollback: a single revert per commit. New endpoints disappear, new
   routes 404, AppBar tabs gone. No on-disk state to undo.

## Open Questions

1. Should the rendered preview support clickable cross-links to
   `[H0001]`, `[D0042]`, `[R0007]`, and experiment ids when those tokens
   appear in the body? Useful, but each link target needs a route, and
   one of those (`[D...]`) only exists as an inbox URL post-this-change.
   Defer to a "cross-link parser" follow-up so this proposal stays
   scoped.

2. Should the inbox poll the directory while the user has the page
   open (so a skill writing a new digest is visible immediately) vs.
   relying on the existing Poller to update the cache? The Poller
   already drives invalidation via SSE in the existing app. Plan: hook
   the inbox into the same SSE invalidation channel that experiments
   and journal use, with a new `'reports' | 'digests'` event tag.

3. Should we surface the `selector` shell snippet that
   `memon-write-report` writes into a report's frontmatter as a
   "re-run" button on the detail view? Probably not in v1 — would
   require shelling out from the web process. Tracked as a follow-up
   if anyone misses it.
