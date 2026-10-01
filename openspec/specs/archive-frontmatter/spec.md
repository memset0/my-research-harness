# archive-frontmatter Specification

## Purpose
Defines the human-only `archived` frontmatter flag on Run READMEs and Experiment READMEs, which hides finished or abandoned work from default listings without deleting it. It covers the archive/unarchive writes, the guard against archiving a `RUNNING` Run, the soft warning on edits to archived items, and the dashboard's archived display modes. The flag lives in each document's frontmatter; parsing and writes are implemented in `@memon/core` and surfaced through `packages/cli` and `apps/web`.

## Requirements
### Requirement: `archived` is a frontmatter boolean on both run README and experiment doc

Both `RunFrontMatter` (run README) and `ExperimentFrontMatter` (experiment doc at `docs/experiments/E*.md`) SHALL carry a required `archived: boolean` field. The field is the canonical and only source of truth for archive state in v4. Default value is `false` for newly-created runs and experiments. The field SHALL appear in YAML frontmatter as `archived: true` or `archived: false` (canonical lowercase boolean tokens).

The legacy `<runDir>/.archived` sidecar mechanism SHALL NOT be consulted by v4 readers as a positive signal. Discovery code SHALL read `frontMatter.archived` and disregard sidecar presence except in the narrow fallback documented under "Sidecar fallback during the migration window."

#### Scenario: New run defaults to archived: false
- **GIVEN** a fresh run dir created by `memon` (whether via CLI, web, or agent scaffold)
- **WHEN** the README is first written
- **THEN** the frontmatter SHALL include `archived: false`
- **AND** no `<runDir>/.archived` sidecar SHALL exist

#### Scenario: New experiment doc defaults to archived: false
- **WHEN** `memon experiment create <slug>` (or web `POST /api/experiments`) succeeds
- **THEN** the new `docs/experiments/E<NNNN>-<slug>.md` SHALL include `archived: false` in its frontmatter

#### Scenario: Hand-edited frontmatter is honored
- **GIVEN** a user opens `docs/experiments/E0001-foo.md` and changes `archived: false` to `archived: true`
- **WHEN** the file is re-read by `memon scan` (or `GET /api/experiments/E0001-foo`)
- **THEN** the parser surfaces the experiment with `archived: true`
- **AND** the dashboard list view (with default checkbox unchecked) hides this experiment from the active section

### Requirement: Archive is human-only; never inferred or auto-set

No code path that runs without explicit user invocation SHALL write `archived: true` on a run or experiment. Specifically:

- The `discoverRuns` / `discoverExperiments` codepath SHALL NOT write `archived` based on heuristics (no "auto-archive runs older than N days").
- The orchestrating agent / `memon-drive` skill SHALL NOT auto-archive items without an explicit user instruction.
- No status transition (e.g. `RUNNING → FINISHED`) SHALL imply or trigger an archive write.

The only legitimate writers of `archived: true` are: (a) the user editing a README directly, (b) `memon run archive <id>` / `memon experiment archive <id>` CLI invocations, (c) the web UI's archive toggle, (d) an agent acting on an explicit user instruction ("archive this run").

#### Scenario: Polling does not auto-archive
- **GIVEN** a run with `status: FINISHED` whose `updated_at` is 90 days old
- **WHEN** the discovery poll re-indexes the project
- **THEN** the run's `archived` field is unchanged
- **AND** no `[ARCHIVE]` event appears in `JOURNAL.md`

### Requirement: Cannot set `archived: true` on a `RUNNING` run

Any code path that writes `archived: true` to a run's frontmatter (CLI `memon run archive`, web archive toggle, README rewrite via `PUT /api/runs/:id/readme` whose new content has `archived: true`) SHALL refuse the write when the run's CURRENT `status === 'RUNNING'`. The refusal SHALL be:
- CLI: exit code 2 with stderr `{"error":{"code":"BAD_REQUEST","message":"cannot archive a RUNNING run; set status to INTERRUPTED, FINISHED, or FAILED first","id":"<run-id>"}}`
- Web: HTTP 422 with body `{"error":{"code":"ARCHIVE_RUNNING_FORBIDDEN","message":"...","id":"<run-id>"}}`

This constraint applies ONLY to the `false → true` transition for runs. The reverse (`true → false`, i.e. unarchive) is always allowed. There is NO analogous constraint for experiment-doc archives or for any combination of exp-status with exp-archive — the rule is run-specific.

When the same write attempt also changes the status (e.g. README rewrite where the new content has both `status: FINISHED` and `archived: true`, while the on-disk version has `status: RUNNING` and `archived: false`), the write SHALL succeed because the post-write `status` is no longer `RUNNING`. The check is against the POST-WRITE state, not the pre-write state.

#### Scenario: CLI refuses archive on RUNNING run
- **GIVEN** a run `foo-260513-100000` with `status: RUNNING`
- **WHEN** the user runs `memon run archive foo-260513-100000 --project-root <p>`
- **THEN** the command exits 2 with the documented JSON error
- **AND** the README is unchanged

#### Scenario: Web refuses archive on RUNNING run
- **GIVEN** a run with `status: RUNNING`
- **WHEN** the web UI's archive toggle is clicked
- **THEN** the underlying request returns 422 with `code: 'ARCHIVE_RUNNING_FORBIDDEN'`
- **AND** the toggle remains in the unchecked position
- **AND** an error toast surfaces the message

#### Scenario: README rewrite that ends in non-RUNNING + archived succeeds
- **GIVEN** a run with on-disk `status: RUNNING, archived: false`
- **WHEN** `PUT /api/runs/:id/readme` is called with new content containing `status: INTERRUPTED, archived: true` (and matching `expectedMtime`)
- **THEN** the write succeeds because the post-write status is not RUNNING

#### Scenario: Unarchive is always allowed, even if status is RUNNING
- **GIVEN** a run with `status: RUNNING, archived: true` (e.g. user manually edited the README)
- **WHEN** the user runs `memon run unarchive <id>`
- **THEN** the command succeeds; `archived: false` is written

### Requirement: Soft warning on writes targeting an archived item

Any write operation that targets a run or experiment with current on-disk `archived: true` (status set, README rewrite, warning add/resolve, link/unlink for exp, doctor info-emit, etc.) SHALL succeed AND surface a warning. The warning is informational only; it does NOT block the operation.

CLI surface: write the literal line `warning: <id> is archived; modifying anyway` to **stderr** before any normal success output. Where the command emits structured JSON to stdout, the stdout JSON additionally carries `"warning": "archived"` so machine consumers see the same signal.

Web surface: the success response body SHALL include `warning: 'archived'` alongside the normal payload (e.g. `{ ok: true, mtime: <n>, warning: 'archived' }`). The React Query mutation handler SHALL display a non-blocking sonner toast with the same message text.

Read operations (`memon list`, `memon show`, `GET /api/runs`, etc.) SHALL NOT emit the warning — only writes do.

The unarchive operation (`archived: true → false`) is itself a write to an archived item, but SHALL NOT emit the warning (the unarchive is the resolution to the archived state, not a "modifying anyway" action).

#### Scenario: Status set on archived run emits warning
- **GIVEN** a run with `archived: true, status: FINISHED`
- **WHEN** the user runs `memon run status set <id> --to FAILED ...`
- **THEN** the command succeeds (exit 0), the status transitions to FAILED
- **AND** stderr contains a line `warning: <id> is archived; modifying anyway`
- **AND** stdout JSON contains `"warning": "archived"`

#### Scenario: Web README write on archived exp emits warning
- **GIVEN** an exp doc with `archived: true`
- **WHEN** the markdown editor saves a body change via `PUT /api/experiments/:id/readme`
- **THEN** the response is 200 with body `{ ok: true, mtime: <n>, hash: <h>, warning: 'archived', ... }`
- **AND** the web client surfaces a sonner toast `warning: <id> is archived; modifying anyway`

#### Scenario: Unarchive itself does not emit the warning
- **GIVEN** an exp doc with `archived: true`
- **WHEN** the user runs `memon experiment unarchive <id>`
- **THEN** the command succeeds and writes `archived: false`
- **AND** stderr does NOT contain the "is archived" warning
- **AND** stdout JSON does NOT contain `"warning": "archived"`

#### Scenario: Read operations are silent on archived items
- **WHEN** the user runs `memon show <id>` against an archived run
- **THEN** the output is the same as for an active run (no warning header)

### Requirement: Archive subcommands write frontmatter atomically with mtime-lock + JOURNAL `[ARCHIVE]` event

`memon run archive <id>` / `memon run unarchive <id>` and the exp-side `memon experiment archive <id>` / `memon experiment unarchive <id>` SHALL:
1. Read the README / exp doc
2. Verify mtime against `--expected-mtime` if provided (otherwise use the just-read mtime); on mismatch, evaluate the idempotency rule below before returning a conflict
3. Compute the new frontmatter with `archived: <true|false>` (the operation's target)
4. Apply the hard rule from `Cannot set archived: true on a RUNNING run` if archiving a run
5. Apply the soft warning rule from `Soft warning on writes targeting an archived item` if the current state is already `archived: true`
6. Atomically write the new README / doc (temp file + rename), bumping `updated_at` to the operation's timestamp
7. Append a single `[ARCHIVE]` event to `JOURNAL.md` with body `\`<id>\` op=<archive|unarchive>` (paralleling existing `[BIND]` / `[STATUS]` event shape)
8. Print success JSON to stdout

For run-side archive, the `--expected-mtime` value SHALL be matched
against the run's `README.md` mtime in isolation — NOT against the
synthesized run-effective mtime from `run-discovery` (which is `max(dir,
README)`). The web client SHALL pass `run.readmeMtime` from the run
record when calling `PATCH /api/runs/:id/archive`; the CLI SHALL pass
the value returned by stat'ing `<runDir>/README.md` directly. For
exp-side archive, the exp doc's path IS the `.md` file so no such
disambiguation is needed.

**Idempotency on stale mtime when target already matches** — when the
provided `--expected-mtime` (or `expectedMtime` on the HTTP route)
does not match the on-disk README/doc mtime BUT the on-disk
`frontMatter.archived` already equals the requested operation's target,
the subcommand / route SHALL succeed with a noop response:
- CLI exits 0 with stdout `{"ok":true,"archived":<target>,"mtime":<n>,"noop":true}`
- HTTP route returns 200 with body `{ ok: true, archived: <target>, mtime: <n>, noop: true }`
- The README / doc is NOT rewritten (mtime not bumped)
- NO `[ARCHIVE]` event is appended

When `expectedMtime` is stale AND the on-disk archived value DIFFERS
from the requested target, the existing CONFLICT behavior applies
(HTTP 409 / CLI exit 9), with the current on-disk content returned in
the conflict payload so the client can rebase.

The `[ARCHIVE]` event SHALL NOT mention sidecar files (the v3 wording `\`<id>\` archived` referencing the sidecar is replaced by `\`<id>\` op=archive` in v4).

#### Scenario: Archive a run writes frontmatter and JOURNAL
- **GIVEN** a run `foo-260513-100000` with on-disk `archived: false, status: FINISHED`
- **WHEN** the user runs `memon run archive foo-260513-100000 --project-root <p>`
- **THEN** the run's README has `archived: true` in frontmatter (atomic write)
- **AND** README `updated_at` is bumped to the command's wall time
- **AND** `JOURNAL.md` has a new line `- <ISO> [ARCHIVE] \`foo-260513-100000\` op=archive`
- **AND** stdout is `{"ok":true,"archived":true,"mtime":<n>}`; exit 0

#### Scenario: Unarchive a run with no current archive is a no-op success
- **GIVEN** a run with `archived: false`
- **WHEN** the user runs `memon run unarchive <id>`
- **THEN** the command exits 0 with `{"ok":true,"archived":false,"noop":true}`
- **AND** README is unchanged (mtime not bumped)
- **AND** no `[ARCHIVE]` event is appended

#### Scenario: Archive an exp doc writes frontmatter and JOURNAL
- **GIVEN** an exp doc `E0001-zero-snr-fix` with on-disk `archived: false`
- **WHEN** the user runs `memon experiment archive E0001-zero-snr-fix --project-root <p>`
- **THEN** the doc's frontmatter has `archived: true` (atomic write)
- **AND** `JOURNAL.md` has a new line `- <ISO> [ARCHIVE] \`E0001-zero-snr-fix\` op=archive`
- **AND** stdout is `{"ok":true,"archived":true,"mtime":<n>}`; exit 0

#### Scenario: Run-dir activity does not block archive
- **GIVEN** a run with on-disk `archived: false, status: FINISHED`, and a
  log file inside the run dir was modified AFTER the README so that
  `dir.mtimeMs > README.mtimeMs`
- **WHEN** the web client (with `run.readmeMtime` from a fresh GET) calls
  `PATCH /api/runs/:id/archive { archived: true, expectedMtime:
  <run.readmeMtime> }`
- **THEN** the response is 200 with `{ ok: true, archived: true,
  mtime: <new> }`
- **AND** the README has `archived: true`
- **AND** `[ARCHIVE] op=archive` appears in JOURNAL

#### Scenario: Stale expectedMtime with matching target is idempotent
- **GIVEN** a run with on-disk `archived: true` (set by an earlier write)
- **WHEN** the client calls `PATCH /api/runs/:id/archive { archived:
  true, expectedMtime: <stale-value> }`
- **THEN** the response is 200 with `{ ok: true, archived: true,
  mtime: <on-disk-mtime>, noop: true }`
- **AND** no JOURNAL event is appended

#### Scenario: Stale expectedMtime with mismatching target still 409s
- **GIVEN** a run with on-disk `archived: true` (after a concurrent write)
- **WHEN** the client (whose view predates the concurrent write) calls
  `PATCH /api/runs/:id/archive { archived: false, expectedMtime:
  <stale-value> }`
- **THEN** the response is 409 with the current on-disk content / mtime
- **AND** the file is NOT rewritten

### Requirement: Sidecar fallback during the migration window

For backward-compatibility with rolled-back v3 readers, projects mid-migration, and projects manually copied between machines, the run-side discovery layer SHALL honor `<runDir>/.archived` as a fallback signal **only** when the run's README lacks the canonical `archived` frontmatter field entirely. Concretely:

- If `frontMatter.archived` is `true` or `false` (the parser successfully read the field), discovery SHALL use that value and SHALL NOT consult the sidecar.
- If `frontMatter.archived` is missing (e.g. the README hasn't been migrated yet or was hand-edited to remove the field), discovery MAY fall back to `archived = exists('<runDir>/.archived')`.
- The fallback SHALL surface a parse warning (`code: 'LEGACY_ARCHIVE_SIDECAR'`) so the user sees the migration nudge.
- The fallback applies only to runs (not exp docs); exp docs never had a sidecar and SHALL fail-closed (treat missing field as `archived: false`).

This fallback path SHALL NOT cause the v3→v4 migration to skip work — the migration always writes the canonical field, then deletes the sidecar.

#### Scenario: README has the field; sidecar is ignored
- **GIVEN** a run with `archived: false` in frontmatter AND a `<runDir>/.archived` file present (e.g. partial-state from a failed copy)
- **WHEN** `memon scan` runs
- **THEN** the run is reported as `archived: false`
- **AND** a parse warning `code: 'LEGACY_ARCHIVE_SIDECAR'` notes the inconsistency

#### Scenario: README lacks the field; sidecar fallback applies
- **GIVEN** a run whose README has no `archived:` line in frontmatter AND `<runDir>/.archived` exists
- **WHEN** `memon scan` runs
- **THEN** the run is reported as `archived: true` from the sidecar fallback
- **AND** a parse warning `code: 'LEGACY_ARCHIVE_SIDECAR'` flags the legacy path

### Requirement: Frontend listing has two display modes for archived items

Both the experiment-card grid (`/p/<project>`) and the run-list pages SHALL render a single "Show archived" checkbox above the listing. The checkbox state SHALL persist per-project via the same client-side preference store used by other sidebar / list preferences.

When the checkbox is **unchecked** (default):
- The listing SHALL render only items with `archived: false` in the upper section, sorted by the existing rule (e.g. `effective_updated_at` desc for the exp grid).
- Below the active section, the listing SHALL render a single muted-text affordance reading `Show <N> archived <experiments|runs>` where `<N>` is the count of items with `archived: true` (with grammatical singular/plural agreement). When `<N>` is 0, the affordance is omitted entirely.
- Clicking the affordance toggles a separate, visually subdued section below the active list containing the archived items, sorted by the same rule. The affordance label updates to `Hide <N> archived <experiments|runs>` while the bucket is shown.
- The reveal state of the bottom-of-list bucket is per-page-load (does NOT persist across reloads).

When the checkbox is **checked**:
- The listing SHALL render archived and active items interleaved in a single list, sorted by the existing rule with no segregation.
- The bottom-of-list "Show <N> archived" affordance is hidden in this mode.
- Archived items remain visually distinguishable via the desaturation overlay and Archive icon described under "Visual treatment of archived items."

#### Scenario: Default unchecked + collapsed shows only active items
- **GIVEN** a project with 7 active experiments and 3 archived experiments
- **WHEN** the user navigates to `/p/<project>` for the first time
- **THEN** the experiment-card grid shows 7 cards (the active ones) sorted by `effective_updated_at` desc
- **AND** below the grid a single line reads `Show 3 archived experiments`
- **AND** the 3 archived experiments are not in the DOM

#### Scenario: Reveal archived bucket shows segregated section
- **GIVEN** the same project, default state
- **WHEN** the user clicks `Show 3 archived experiments`
- **THEN** the active 7-card grid remains in place
- **AND** below it a new section appears containing the 3 archived cards, sorted by `effective_updated_at` desc among themselves
- **AND** the affordance now reads `Hide 3 archived experiments`

#### Scenario: Checkbox checked interleaves archived and active
- **GIVEN** the same project
- **WHEN** the user ticks the "Show archived" checkbox
- **THEN** the grid renders 10 cards in a single sort by `effective_updated_at` desc
- **AND** archived cards are intermixed with active cards in their natural sort position
- **AND** the bottom-of-list "Show N archived" affordance is no longer rendered

#### Scenario: Toggling the checkbox does not mutate disk state
- **WHEN** the user ticks or unticks the "Show archived" checkbox
- **THEN** no HTTP request is made that would write README files or JOURNAL events
- **AND** the user's choice persists in client-side storage only

#### Scenario: Sidebar excludes archived items entirely
- **GIVEN** a per-project experiment list in the sidebar AND there are archived experiments in the project
- **WHEN** the sidebar renders
- **THEN** the sidebar SHALL show only active (non-archived) experiments
- **AND** there SHALL NOT be any "Show N archived" affordance in the sidebar
- **AND** the only place archived items surface is on the main experiment-card grid (per the rules above), where the "Show archived" checkbox controls visibility

### Requirement: Visual treatment of archived items

Archived runs and experiments rendered anywhere in the dashboard (grid cards, sidebar, search results, anomaly banners that reference them) SHALL render with:
- A reduced-opacity wrapper (`opacity-60` or equivalent shadcn-tokenized treatment) on the card body.
- A `lucide-react Archive` icon prefix immediately before the status pill.
- The status pill itself SHALL render in a desaturated variant (e.g. switching `bg-emerald-100` → `bg-emerald-50` and `text-emerald-800` → `text-emerald-600` for `RESOLVED`-archived; analogous shifts for other statuses). The icon inside the pill is unchanged.

The visual treatment SHALL be the only signal carried through to non-text consumers (screen readers — the wrapper SHALL also include `aria-label` containing the literal word `archived`).

#### Scenario: Archived experiment card visual
- **GIVEN** an experiment with `archived: true, status: RESOLVED`
- **WHEN** the experiment card renders on the grid (whether checkbox checked or in the segregated bucket)
- **THEN** the card's outer wrapper has the reduced-opacity class
- **AND** the status pill area renders as `<Archive icon> <CheckCircle2 icon> RESOLVED` on a desaturated emerald variant
- **AND** the wrapper's `aria-label` contains the word `archived`
