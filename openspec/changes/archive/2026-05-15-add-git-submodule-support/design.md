## Context

Research repos accumulate submodules over time — vendored libraries
fixed at known SHAs, fork-of-a-fork theme repos, documentation
sources pulled in via `git submodule add`. The existing
dashboard infrastructure pretends submodules don't exist:

- `readGitStatus*` calls `git status --porcelain=v2 --branch
  --ignore-submodules=all` — the `--ignore-submodules=all` flag
  was a deliberate choice to keep the pill cheap, but it also
  hides any submodule activity from the dialog.
- The history dialog only browses the main repo's `refs/heads`.
- Commit marks are keyed by `sha` alone — collisions between
  the main repo's commit graph and a submodule's commit graph
  are vanishingly unlikely in practice but the data model can't
  express the difference.

Submodule names per `.gitmodules`'s `[submodule "<name>"]` header
become the wire identifier everywhere — that's what `git
submodule` itself uses internally.

## Goals / Non-Goals

**Goals:**

- A clean `?submodule=<name>` scoping convention shared by all
  existing git endpoints. When omitted, behaviour is the main
  repo (today's behaviour).
- The status dialog shows the main repo's three sections AND a
  matching block per submodule.
- The history dialog gets a submodule selector beside the branch
  selector. Switching submodule re-targets every downstream query.
- The commit-marks CSV gains a `submodule` column; reader
  back-compat for the 4-column legacy file.

**Non-Goals:**

- Recursive / nested submodules. Top-level only in v1.
- Polling submodules in the pill — the pill's polling endpoint
  still reflects main-repo state only. Submodule fanout there
  would defeat the cost contract.
- Editing submodule pins ("update submodule to commit X") — read
  only, same posture as commits in the history dialog.
- Cross-submodule rollups ("show me all `verified` marks across
  every submodule") — out of scope.

## Decisions

### D1. Submodule identifier on the wire = `.gitmodules` name

`.gitmodules` looks like:

```ini
[submodule "vendor/foo-lib"]
    path = vendor/foo-lib
    url = https://github.com/.../foo-lib.git
```

The name (`vendor/foo-lib`) is what we use everywhere — URL query
param, CSV column, API response field. The `path` is used INTERNALLY
to resolve the cwd. By convention name == path, but we don't
require it.

Validation: a submodule name must match the names returned by
`readGitSubmodules(projectRoot)` for the project. Routes reject
unknown names with 400 before invoking the underlying reader.

### D2. New endpoint: `GET /api/projects/:p/submodules`

Returns:

```ts
type SubmodulesResponse =
  | { enabled: false; reason: ... }
  | {
      enabled: true
      submodules: { name: string; path: string }[]
    }
```

The dialog (both status and history) fetches this once on open.
Empty `submodules: []` is the no-submodules case; UI degrades
gracefully (no extra sections, no submodule selector — or a
selector with only "main" visible).

### D3. All existing git endpoints accept `submodule=<name>`

Affected: `/git-status/files`, `/git-diff`, `/git-branches`,
`/git-log`, `/git-commit`. Each route handler:

1. Resolves the project as usual.
2. If `submodule` query param is present:
   - Calls `readGitSubmodules(project.root)` to validate the name
     (rejects with 400 if not in the list).
   - Resolves the effective cwd: `<project.root>/<submodule.path>`.
3. Otherwise, cwd = `project.root` (main repo, current behaviour).
4. Invokes the existing reader with the resolved cwd.

This keeps the core readers (`readGitStatusFiles`, `readGitLog`,
etc.) UNCHANGED — they already accept any cwd. The route layer
owns the submodule resolution and validation.

### D4. Status dialog layout — stacked blocks per repo

```
┌──────────────────────────────────────────────────────┐
│ git status — project-a                          [✕]  │
├──────────────────────────────────────────────────────┤
│  [toolbar: view-mode + View history link]            │
├──────────────────────────────────────────────────────┤
│  MAIN REPO                                           │
│  Staged (2)                                          │
│  Unstaged (3)                                        │
│  Untracked (1)                                       │
│                                                      │
│  SUBMODULE: vendor/foo-lib                           │
│  Staged (0)                                          │
│  Unstaged (1)                                        │
│  Untracked (0)                                       │
│                                                      │
│  SUBMODULE: themes/dark                              │
│  Staged (0)                                          │
│  Unstaged (0)                                        │
│  Untracked (0)                                       │
└──────────────────────────────────────────────────────┘
```

Each repo block fires its own `/git-status/files?submodule=<name>`
query. Empty submodules still render their header + the `(none)`
placeholders for consistency. `<FileRow />` carries `submodule`
along with `project / side / entry` so its diff query is correctly
keyed.

### D5. History dialog — submodule selector beside branch selector

Toolbar from left to right:

```
[ submodule: main ▾ ] [ branch: <current> ▾ ] [↻]   ...   [view: split | inline]
```

- Submodule select includes a synthetic "main" entry (value
  `''` or a sentinel) plus one entry per submodule.
- Default: `main`.
- Switching submodule:
  - clears `selectedRef` (forces re-default to the new repo's
    current HEAD) and `selectedSha`,
  - the `['git-branches', project, submodule]` query refetches.
- Refresh button invalidates `['git-branches', project, submodule]`
  AND `['git-log', project, submodule, ref]` — submodule-scoped.
- Per-commit detail + per-file diff queries are also keyed by
  submodule so two repos' identical SHAs (rare but possible) can
  coexist in the cache.

### D6. Commit-marks CSV — new column + back-compat

New header:

```csv
sha,status,note,updated_at,submodule
```

Sort order: `(submodule, sha)` ascending — empty submodule
(main repo) sorts first, then submodule entries grouped by name.

The reader accepts BOTH:

- Legacy 4-column header `sha,status,note,updated_at` → all rows
  treated as `submodule = ''` (main repo). Behaves transparently;
  no migration prompt.
- New 5-column header `sha,status,note,updated_at,submodule` → use
  the column directly.

The writer ALWAYS emits 5 columns. So the next time the user
saves anything, the file upgrades to the new schema. Empty
submodule cells are written as the empty string between commas
(`...,2026-05-15T12:00:00+08:00,`).

### D7. Composite key on the wire — switch to `marks: CommitMark[]`

The previous response shape was `Record<sha, CommitMark>`. With
the new dimension, the composite key would be either
`(submodule, sha)` (an object) or `<submodule>:<sha>` (a string).
Both are awkward to consume from JS.

**Chosen:** array `marks: CommitMark[]` where each `CommitMark`
carries an optional `submodule` field. The client builds the
appropriate lookup map (e.g.
`marks.find(m => m.sha === sha && (m.submodule ?? '') === scope)`).
Simple and unambiguous.

`PUT /commit-marks/:sha?submodule=<name>` and
`DELETE /commit-marks/:sha?submodule=<name>` — the existing route
paths stay; `submodule` is a query param. Missing → main repo.

### D8. `<FileRow />` API extension

Currently:
`<FileRow project side sha? entry />`.

Add an optional `submodule?: string`:
`<FileRow project side sha? submodule? entry />`. The submodule
is part of the row's diff query key so two repos with identical
file paths don't collide in the TanStack cache.

`fetchGitDiff(project, path, side, sha?, submodule?)` — new
optional final positional arg. All existing call sites pass
`undefined` and behave identically.

### D9. `<CommitMarkBadge />` and `<CommitMarkEditor />`

Both stay agnostic of the submodule semantics — the parent passes
the right `mark` (already looked up by `(sha, submodule)`) and the
editor's `setCommitMark` call carries the current submodule
through to the API. Adding a `submodule?: string` prop to the
editor (passed straight through to the mutation) is enough.

The badge needs no changes — it just renders whatever `mark` it's
given.

### D10. Caching keys updated everywhere

Every TanStack query that previously included `project` (and maybe
`ref` / `sha`) needs `submodule` in its key when applicable:

- `['git-branches', project, submodule]`
- `['git-log', project, submodule, ref]`
- `['git-commit', project, submodule, sha]`
- `['git-diff', project, path, side, sha?, submodule?]`
- `['git-status-files', project, submodule]` — the status dialog
  fires one of these per repo (main + each submodule)
- `['commit-marks', project]` — UNCHANGED (single query returns
  all marks; client filters per submodule)
- `['submodules', project]` — new

## Risks / Trade-offs

- **[Submodule cwd doesn't exist on disk]** → user hasn't run
  `git submodule update --init`. `readGitStatusFiles` returns
  `{ enabled: false, reason: 'not-a-repo' }` for that cwd; the
  dialog renders the submodule's block with the "not a git
  repository" placeholder. Acceptable; future enhancement could
  detect uninitialised state and offer a hint.
- **[Submodule path has spaces / unicode]** → handled by Node's
  `path.resolve` and the fact that we never embed the path in a
  shell command. `git status` is invoked via `execFile`.
- **[Many submodules → slow dialog open]** → N parallel
  `git status` invocations. Each is fast (a few ms typical). For
  repos with > 20 submodules, the dialog may take a noticeable
  fraction of a second. Acceptable for v1; can add request
  batching or sequential fetch with progress later.
- **[Submodule rename in `.gitmodules`]** → existing marks keyed by
  the old name orphan. v1 accepts the cost; future enhancement
  could surface orphaned marks in a "stale" section.
- **[The legacy 4-column CSV gets written by a older-version client
  while a newer client is also writing]** → atomic rename means
  no corruption, just whoever wrote last wins. The newer client
  reads the legacy form correctly on its next refetch.

## Migration Plan

No on-disk migration is forced. The CSV migrates LAZILY on first
write after deployment. Until then, the file stays in its
4-column form and reads as all-main-repo entries.

Roll forward: deploy → existing dialogs gain submodule sections /
selector. Existing marks keep working.

Roll back: revert. The CSV files that have already been upgraded
to 5 columns will be read by an old client. The old reader's
behaviour on extra columns is to surface a parse warning and
skip the row (per the existing `parseCsv` behaviour). Not great,
but the user can manually trim the 5th column or just re-mark.
Spec calls this out so we're not surprised later.

## Open Questions

- **Should the history dialog support viewing the MAIN repo's
  commit that points to a given submodule pin?** I.e. "click on
  a submodule's selected commit → show the main-repo commit
  that includes this submodule SHA". Probably useful but a
  separate feature. Out of scope.
- **Should the status dialog show submodule pointer changes
  themselves?** When the user `git add`s a submodule pointer
  bump in the main repo, that's a change to the SUBMODULE line in
  the main repo's index, distinct from a change INSIDE the
  submodule. We currently `--ignore-submodules=all` in the main
  repo's status call. We could relax that and treat the pointer
  bump as a regular file entry. Defer until users ask.
