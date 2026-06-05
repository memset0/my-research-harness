# code-review-store Specification

## Purpose
TBD - created by archiving change add-code-review-docs. Update Purpose after archive.
## Requirements
### Requirement: Code-review docs live at two scoped locations

The dashboard SHALL discover, parse, and serve markdown files named
`<YYYY-MM-DD>-<slug>.md` (base-name regex
`^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$`) from two location families per
project:

- **project-wide**: `<projectRoot>/docs/code-review/`
- **experiment-scoped**: `<projectRoot>/docs/experiments/E<NNNN>-<slug>/code-review/`

Files in those directories that do not match the regex SHALL be ignored (they
are not code-reviews; no warning). Discovery SHALL look one level deep inside
each `code-review/` directory only. A doc's **scope** is determined by which
family it lives in. The frontmatter `experiment` field SHALL be the canonical
association used for grouping: for experiment-scoped docs it SHALL equal the
enclosing `E<NNNN>-<slug>`, and for project-wide docs it SHALL be
`null`/absent. If a file's frontmatter `experiment` disagrees with its
location, the frontmatter value wins for grouping (no warning in v1).

#### Scenario: Match in both locations
- **GIVEN** `docs/code-review/2026-05-24-bf16-fix.md` and `docs/experiments/E0042-attn/code-review/2026-05-24-bf16-fix.md`
- **WHEN** the API lists code-reviews
- **THEN** both are returned — the first project-wide (`experiment` null), the second associated to `E0042-attn`

#### Scenario: Ignore non-matching files
- **GIVEN** an extra `docs/code-review/notes.md`
- **WHEN** the API lists code-reviews
- **THEN** `notes.md` is NOT in the result

### Requirement: Frontmatter is the parsed contract; body is opaque

Each code-review doc SHALL carry YAML frontmatter validated into:
- `title: string` (required)
- `description: string` (default empty)
- `experiment: string | null`
- `created_at`, `updated_at`: ISO8601 strings with timezone offset (required)
- `commits: Array<{ repo: string; sha: string; url: string; subject?: string; reviewed: boolean }>` —
  `repo` is the path relative to project root (`.` = main repo, otherwise a
  submodule path); `url` is an already-resolved, directly-openable GitHub
  commit URL; `reviewed` defaults to `false`
- `review_todolist: Array<{ item: string; done: boolean }>` — `done` defaults
  to `false`

The markdown body below the frontmatter SHALL be treated as opaque: never
parsed for section structure, never emitting `UNKNOWN_H2_SECTION`-style
warnings, and preserved byte-for-byte on any progress write.

#### Scenario: Lenient defaults
- **GIVEN** a doc where a commit entry omits `reviewed` and a todolist item omits `done`
- **WHEN** the doc is parsed
- **THEN** the missing booleans default to `false` and parsing succeeds

#### Scenario: Body preserved on write
- **WHEN** a progress toggle rewrites the frontmatter
- **THEN** the markdown body bytes are identical before and after

### Requirement: Completion is derived from the checkboxes

A code-review's completion SHALL be derived, not stored. The summary SHALL
report `totalCommits`, `reviewedCommits`, `totalTodos`, `doneTodos`, and
`isComplete`, where `isComplete` is true iff `totalCommits + totalTodos > 0`
AND every commit is `reviewed` AND every todolist item is `done`. There SHALL
be no separate status field.

#### Scenario: All boxes checked
- **GIVEN** a doc with 2 commits both `reviewed` and 3 todos all `done`
- **THEN** `isComplete` is `true` with summary `2/2` commits, `3/3` todos

#### Scenario: Empty review is not complete
- **GIVEN** a doc with no commits and no todolist items
- **THEN** `isComplete` is `false`

### Requirement: GET /api/code-reviews?project=NAME lists all reviews

`GET /api/code-reviews?project=<name>` SHALL return
`{ codeReviews: CodeReviewSummary[] }` sorted by date descending (ties broken
by `id`). Each `CodeReviewSummary` SHALL include `id` (the path relative to
`<root>/docs/`, without `.md`), `scope` (`project` | `experiment`),
`experiment` (id or null), `title`, `createdAt`, `updatedAt`, `path`
(absolute), `mtime`, and the completion summary. The list SHALL be served
from the runtime cache (no per-request directory scan).

#### Scenario: Empty / missing directories
- **WHEN** a project has neither `docs/code-review/` nor any experiment `code-review/`
- **THEN** the API returns `{ codeReviews: [] }` with HTTP 200

#### Scenario: Sort by date desc
- **GIVEN** docs dated 2026-05-01, 2026-05-09, 2026-05-04
- **THEN** the order is 2026-05-09, 2026-05-04, 2026-05-01

### Requirement: GET /api/code-reviews/[...id]?project=NAME returns one review

`GET /api/code-reviews/<...id>?project=<name>` SHALL return
`{ id, scope, experiment, frontmatter, body, mtime, hash }` for the doc whose
id (docs-relative path minus `.md`) resolves to an existing file. `hash`
SHALL be the sha1 hex of the UTF-8 content. The reconstructed absolute path
SHALL be validated by `assertWithinProjectRoots()` (→ 403 FORBIDDEN), and the
docs-relative id SHALL match exactly one of
`code-review/<date>-<slug>` or
`experiments/E<NNNN>-<slug>/code-review/<date>-<slug>`
(→ 400 BAD_REQUEST otherwise). A well-formed id with no file → 404 NOT_FOUND.

#### Scenario: Read a project-wide review
- **WHEN** `/api/code-reviews/code-review/2026-05-24-foo?project=p` is requested
- **THEN** the response includes parsed frontmatter, the raw body, mtime, and sha1 hash, with `scope: "project"`

#### Scenario: Read an experiment-scoped review
- **WHEN** `/api/code-reviews/experiments/E0042-attn/code-review/2026-05-24-foo?project=p` is requested
- **THEN** the nested file resolves with `scope: "experiment"` and `experiment: "E0042-attn"`

#### Scenario: Bad id shape
- **WHEN** the id does not match either allowed shape
- **THEN** the response is 400 BAD_REQUEST (or 403 FORBIDDEN if it escapes project roots)

#### Scenario: Missing file
- **WHEN** a well-formed id has no file on disk
- **THEN** the response is 404 NOT_FOUND

### Requirement: PATCH /api/code-reviews/[...id]?project=NAME toggles one progress flag with optimistic lock

`PATCH /api/code-reviews/<...id>?project=<name>` body SHALL be exactly one of:
- `{ op: "commit", sha, reviewed, expectedMtime, expectedHash }`
- `{ op: "todo", index, done, expectedMtime, expectedHash }`

The server SHALL re-read the file; if on-disk mtime !== `expectedMtime` OR
sha1 !== `expectedHash`, it SHALL return 409 CONFLICT with
`{ error: { code: "CONFLICT" }, currentMtime, currentHash }`. Otherwise it
SHALL flip the addressed `commits[].reviewed` (matched by `sha`) or
`review_todolist[index].done`, bump `updated_at` to now (ISO8601 + offset),
re-serialize ONLY the frontmatter (body preserved byte-for-byte), and write
atomically via a `.tmp.<rand>` sibling + rename. On success it SHALL return
`{ ok: true, mtime, hash, completion }` reflecting post-write state. The path
SHALL be validated by `assertWithinProjectRoots()` (→ 403). An unknown `sha`
or out-of-range `index` → 400 BAD_REQUEST.

#### Scenario: Toggle a commit checkbox
- **GIVEN** the client read mtime/hash, then checks a commit
- **WHEN** PATCH `{ op: "commit", sha, reviewed: true, expectedMtime, expectedHash }` arrives matching
- **THEN** that commit's `reviewed` becomes true, `updated_at` is bumped, the body is unchanged, and the response carries the new mtime/hash + recomputed completion

#### Scenario: Stale snapshot → 409
- **GIVEN** an external write landed since the client's read
- **WHEN** PATCH arrives with the now-stale `expectedMtime`
- **THEN** the response is 409 CONFLICT with the current mtime/hash

#### Scenario: Path traversal blocked
- **WHEN** the resolved path is outside any configured project root
- **THEN** the response is 403 FORBIDDEN

### Requirement: Live discovery via Poller (no fs.watch)

Discovery SHALL be Poller-driven with the standard backoff (1s → 5min × 2)
and SHALL NOT use `fs.watch`/inotify. The flat `docs/code-review/`
directories are watched statically; the experiment `code-review/` directory
set is reconciled at runtime as experiments and their `code-review/` subdirs
appear and disappear (see the `runtime-cache` capability). External writes (a
skill creating a doc, a hand-edit) SHALL become visible within the polling
window without a server restart.

#### Scenario: Skill-written doc appears
- **WHEN** an external process writes a new `<date>-<slug>.md` into a watched `code-review/` directory
- **THEN** within the polling window the list reflects it and a `code-reviews-change` SSE event fires

