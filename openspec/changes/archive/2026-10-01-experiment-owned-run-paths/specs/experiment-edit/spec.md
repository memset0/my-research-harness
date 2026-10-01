## ADDED Requirements

### Requirement: FS v7 membership edits are one-sided
For FS v7, create-from-run, link, unlink, rename and delete SHALL update Experiment-owned declarations without rewriting a Run README to assign or clear ownership. This replaces v6 bidirectional binding edits. Existing access control, optimistic concurrency and journal invocation recording SHALL remain enforced.

#### Scenario: Link then unlink
- **WHEN** an authorized caller links and unlinks a valid Run path
- **THEN** only the Experiment membership declaration and normal audit state change, and Run README bytes and mtime remain unchanged

#### Scenario: Rename Experiment
- **WHEN** an Experiment is renamed
- **THEN** its project-relative member paths remain valid without rewriting member Run frontmatter

## MODIFIED Requirements

### Requirement: `memon experiment create` allocates next E ID

The CLI SHALL expose `memon experiment create <slug> [--title <text>]
[--hypotheses H0001,H0003] [--from-run <run-dir>] [--project-root <p>]`.

The command SHALL:
1. Validate `<slug>` matches `^[a-z0-9][a-z0-9-]*[a-z0-9]$`.
2. Scan `docs/experiments/` to find the highest existing `NNNN`. The
   scan SHALL accept each entry that matches *either* the post-v5
   folder shape `E<NNNN>-<slug>` (`EXPERIMENT_DIR_REGEX`) *or* the
   legacy v4 file shape `E<NNNN>-<slug>.md` (`EXPERIMENT_FILENAME_REGEX`,
   retained for the v4→v5 migration window where both forms may
   coexist briefly). The next id SHALL be computed as `padId('E', max+1)`
   across the union of both forms. When the directory does not exist
   the next id SHALL be `'E0001'`.
3. Refuse if any existing exp doc's slug equals the new slug or is a
   prefix of (or has as prefix) the new slug.
4. Write `docs/experiments/E<NNNN>-<slug>/README.md` (post-v5: an
   `E<NNNN>-<slug>/` folder containing a `README.md`) with frontmatter
   populated (`id`, `slug`, `title`, `hypotheses`, `tags=[]`, `runs`
   initially `[]` or seeded from `--from-run`, `created_at=now`,
   `updated_at=now`, plus `status: OPEN` and `archived: false` per
   `lifecycle-frontmatter-v4`) and empty body sections (`Motivation`,
   `Method`, `Conclusion`, `Caveats`, `Warnings` with the v3 header
   row). The folder is also the experiment's sanctioned local scratch
   space; the create step creates only the folder + README, and
   nothing else inside.
5. If `--from-run <run-dir>` is given, validate the run exists and add
   its project-relative path to the new exp's `runs[]` without writing
   the Run README. The run SHALL NOT already be declared by a different
   Experiment (would surface a `BAD_STATE` error).
6. Append a `[EXPERIMENT]` event with `op=create` to JOURNAL.

The command SHALL be retried up to 5 times if step 4's directory or
file creation hits `EEXIST` (race against concurrent allocations);
after 5 failures, exit with `BAD_STATE`.

#### Scenario: Successful create on a v5 project root
- **WHEN** the user runs `memon experiment create zero-snr-fix --title
  "Zero-SNR brightness study"` on a project root where no experiments
  exist
- **THEN** `docs/experiments/E0001-zero-snr-fix/README.md` exists with
  valid frontmatter, body sections present, and JOURNAL has an
  `op=create` event

#### Scenario: Allocation respects existing v5 folders
- **GIVEN** a project root containing the v5 folders
  `docs/experiments/E0001-foo/README.md`,
  `docs/experiments/E0003-baz/README.md`,
  `docs/experiments/E0007-bar/README.md`
- **WHEN** the user runs `memon experiment create new-thing`
- **THEN** the new experiment is written to
  `docs/experiments/E0008-new-thing/README.md` (NOT `E0001-`,
  `E0002-`, `E0004-`, or `E0008-` if a `.md` legacy file at any of
  those numbers were also present; see next scenario)

#### Scenario: Allocation counts legacy v4 entries during migration
- **GIVEN** a project root mid-migration with both
  `docs/experiments/E0001-foo/README.md` (v5 folder) and
  `docs/experiments/E0002-legacy.md` (v4 file not yet moved)
- **WHEN** the user runs `memon experiment create third`
- **THEN** the new experiment is allocated as `E0003-third` (max+1 over
  the union of both forms), written to
  `docs/experiments/E0003-third/README.md`

#### Scenario: --from-run binds existing run
- **WHEN** the user runs `memon experiment create foo --from-run
  bar-260501-100000` and that Run lives at `logs/bar-260501-100000`
- **THEN** the new exp's `runs[]` contains `logs/bar-260501-100000`, and the
  Run README bytes and mtime are unchanged

#### Scenario: Slug prefix collision rejected
- **GIVEN** `E0001-foo` already exists (as a v5 folder)
- **WHEN** the user runs `memon experiment create foo-bar`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION` and
  no folder or file is written

### Requirement: `memon experiment link` and `unlink`

`memon experiment link <id> <run-dir-or-id> [--project-root <p>]` SHALL:
1. Validate the experiment doc exists.
2. Validate the run exists.
3. Refuse if a different Experiment already declares the run
   (`BAD_STATE`); print the conflicting exp id.
4. Append the run's project-relative path to the exp's `runs[]` (if not
   already present), replacing a legacy bare-ID entry for the same Run.
5. Leave the Run README untouched.
6. Append a `[BIND]` event with `op=link` to JOURNAL.
7. Print a non-blocking warning (stderr) if the run slug does NOT have
   the experiment slug as a prefix.

`memon experiment unlink <id> <run-dir-or-id>` SHALL undo the binding:
remove the run's path (or a legacy bare-ID entry for it) from
`exp.runs[]` without touching the Run README, append a `[BIND]` event with `op=unlink`.

#### Scenario: Link respects soft prefix rule
- **GIVEN** `E0001-zero-snr-fix` and an unbound run `cfg-rescale-260502-...`
- **WHEN** the user runs `memon experiment link E0001-zero-snr-fix
  cfg-rescale-260502-...`
- **THEN** the link succeeds (exit 0); stderr contains a
  `RUN_SLUG_PREFIX_VIOLATION` warning

#### Scenario: Link rejected when run already bound elsewhere
- **GIVEN** a run declared in `E0002-bar.runs[]`
- **WHEN** the user runs `memon experiment link E0001-foo <that-run>`
- **THEN** the command exits with `BAD_STATE` and stderr names the
  conflicting exp id `E0002-bar`; the user must `unlink` first

### Requirement: `memon experiment delete` cascades unlinks

`memon experiment delete <id> [--force] [--project-root <p>]` SHALL:
1. Read the exp doc.
2. Release its members by removing the declaration itself; no Run
   README is rewritten.
3. Delete the exp doc folder (the four canonical bundle files; other
   scratch content only with `--force`).
4. Append a `[EXPERIMENT]` event with `op=delete` and the deleted
   `runs[]` payload to JOURNAL.

Without `--force`, the command SHALL refuse when the experiment still
declares member runs, naming how many would be released (JSON mode cannot
prompt). With `--force`, the deletion proceeds.

#### Scenario: Delete cascades and prompts
- **GIVEN** an exp `E0001-foo` with three confirmed runs
- **WHEN** the user runs `memon experiment delete E0001-foo` (no
  --force)
- **THEN** the CLI refuses and names the 3 declared runs that `--force`
  would release; nothing is deleted and no Run README changes

#### Scenario: --force skips prompt
- **WHEN** the same command runs with `--force`
- **THEN** the experiment folder is deleted, the three Runs are no longer
  declared by any Experiment, their README bytes are unchanged, and the
  deletion is recorded with the released `runs[]` payload

### Requirement: memon experiment rename cascades the new slug through exp, runs, and hypotheses

The CLI SHALL expose `memon experiment rename <id-or-slug> <new-slug> [--project-root <p>]`. The core library SHALL expose `renameExperiment(projectRoot, projectName, oldIdOrSlug, newSlug, options?): Promise<RenameExperimentResult>` as the underlying primitive. The command and the helper SHALL:

1. Validate `<new-slug>` against `^[a-z0-9][a-z0-9-]*[a-z0-9]?$` and reject `BAD_REQUEST` when it includes a trailing `-<YYMMDD>-<HHMMSS>` timestamp tail (the same SLUG_RE shape `memon run rename` uses).
2. Resolve `<id-or-slug>` to a canonical `E<NNNN>-<slug>` via `resolveExperimentId`. On no match, exit with `NOT_FOUND`.
3. Compute the new canonical id: `newId = E<oldNNNN>-<new-slug>` (the `NNNN` is preserved; only the slug part changes).
4. Treat `new-slug === old-slug` as a noop and return `{ ok: true, oldId, newId: oldId, noop: true }` without touching disk.
5. Refuse with `EXPERIMENT_SLUG_PREFIX_COLLISION` when another existing experiment has slug equal to `new-slug`, OR when `new-slug` is a prefix of another experiment's slug or vice versa (same uniqueness rule as `memon experiment create`).
6. On a v5 record, rename the experiment folder from `docs/experiments/<oldId>` to `docs/experiments/<newId>` via `fs.rename`. On the legacy v4 file form (`exp.path` ends in `<oldId>.md`), rename the single `.md` file to `<newId>.md`.
7. Open the post-rename README, set `frontMatter.id = newId`, `frontMatter.slug = new-slug`, `frontMatter.updated_at = nowIso()`, and atomic-write the re-serialized content.
8. Leave member Runs untouched: their project-relative declarations stay valid, and no Run README is read for ownership or rewritten. Member Run slugs are checked only for the soft prefix warning.
9. Read `<projectRoot>/docs/hypotheses.md` and perform a token substitution of `oldId` → `newId` over the body. The substitution SHALL use word-boundary semantics (`\bE\d{4}-[a-z0-9-]+\b`) so that `oldId` cannot match a substring of an unrelated longer token. The atomic-write SHALL be skipped when the file content is unchanged.
10. Append one `[RENAME]` event to `docs/journal.md` with body `op=experiment-rename old=<oldId> new=<newId>`.

The command SHALL emit JSON on stdout: `{ ok: true, oldId, newId, noop?: true, warnings?: [...] }`. Soft warnings (e.g. a member run whose slug doesn't start with `new-slug`) SHALL appear both as one-line `{warning:{code,message}}` JSON events on stderr AND inside the stdout `warnings` array.

The command SHALL NOT roll back on partial failure. The validate-first posture catches every recoverable error before any disk mutation; if a later step fails (e.g. permission denied on a run README write), the user resolves manually via git and re-runs (the operation is idempotent on already-renamed input).

#### Scenario: Successful rename rewrites exp folder, bound runs, and hypotheses
- **GIVEN** a project root with:
  - Experiment folder `docs/experiments/E0001-foo/README.md` with `frontMatter.runs = ['logs/foo-260501-100000', 'logs/foo-260502-110000']`
  - Two declared runs `logs/foo-260501-100000/README.md` and `logs/foo-260502-110000/README.md` with no `experiment` field
  - A hypothesis in `docs/hypotheses.md` with `**Experiments**: E0001-foo` in its body
- **WHEN** the user runs `memon experiment rename E0001-foo zero-snr --project-root <root>`
- **THEN** stdout is `{"ok":true,"oldId":"E0001-foo","newId":"E0001-zero-snr"}`
- **AND** the folder `docs/experiments/E0001-zero-snr/` exists; `docs/experiments/E0001-foo/` does not
- **AND** the new folder's `README.md` frontmatter has `id: E0001-zero-snr`, `slug: zero-snr`, and `updated_at` bumped
- **AND** both declared runs' README bytes and mtimes are unchanged, and `runs[]` still lists the same two paths
- **AND** `docs/hypotheses.md` contains `E0001-zero-snr` where `E0001-foo` previously appeared, with no other body changes
- **AND** `docs/journal.md` gains one new line: `- <ISO> [RENAME] op=experiment-rename old=E0001-foo new=E0001-zero-snr`

#### Scenario: Noop on same slug
- **GIVEN** experiment `E0001-foo` exists
- **WHEN** the user runs `memon experiment rename E0001-foo foo`
- **THEN** stdout is `{"ok":true,"oldId":"E0001-foo","newId":"E0001-foo","noop":true}`
- **AND** no disk write happens; mtimes unchanged; no JOURNAL event appended

#### Scenario: Slug uniqueness rejected
- **GIVEN** experiments `E0001-foo` and `E0002-bar` both exist
- **WHEN** the user runs `memon experiment rename E0001-foo bar`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION`
- **AND** stderr names the conflicting experiment `E0002-bar`
- **AND** no folder rename happens

#### Scenario: Slug prefix collision rejected
- **GIVEN** experiments `E0001-old` (slug `old`) and `E0002-foo` (slug `foo`) exist
- **WHEN** the user runs `memon experiment rename E0001-old foo-bar`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION`
  (because the existing slug `foo` is a prefix of the new slug `foo-bar` — same rule `memon experiment create` enforces)
- **AND** no disk mutation happens

#### Scenario: Slug prefix collision rejected the other direction
- **GIVEN** experiments `E0001-old` (slug `old`) and `E0002-foo-bar` (slug `foo-bar`) exist
- **WHEN** the user runs `memon experiment rename E0001-old foo`
- **THEN** the command exits with `EXPERIMENT_SLUG_PREFIX_COLLISION`
  (because the new slug `foo` is a prefix of the existing slug `foo-bar`)
- **AND** no disk mutation happens

#### Scenario: Invalid new slug shape rejected
- **WHEN** the user runs `memon experiment rename E0001-foo Foo`
  (uppercase) OR `memon experiment rename E0001-foo bar-260501-100000`
  (timestamp tail)
- **THEN** the command exits with `BAD_REQUEST`
- **AND** stderr names the SLUG_RE pattern

#### Scenario: Missing experiment id returns NOT_FOUND
- **WHEN** the user runs `memon experiment rename E0099-missing baz`
  on a project root that does not contain `E0099-missing`
- **THEN** the command exits with `NOT_FOUND`
- **AND** no disk mutation happens

#### Scenario: Member run slug-prefix violation surfaces a soft warning
- **GIVEN** experiment `E0001-foo` with member run `foo-260501-100000`
  (whose slug `foo` starts with the exp slug `foo`)
- **WHEN** the user runs `memon experiment rename E0001-foo bar`
  (so the new exp slug `bar` is no longer a prefix of the run slug `foo`)
- **THEN** the rename SHALL succeed (exit 0)
- **AND** stderr contains one line per offending member run with shape
  `{"warning":{"code":"RUN_SLUG_PREFIX_VIOLATION","message":"run slug \\"foo\\" does not start with experiment slug \\"bar\\""}}`
- **AND** stdout's `warnings` array contains an entry for each
  offending member run

#### Scenario: Idempotent re-run on already-renamed state
- **GIVEN** an exp at `docs/experiments/E0001-bar/` whose
  `frontMatter.id` is `E0001-bar`
- **WHEN** the user runs `memon experiment rename E0001-bar bar`
- **THEN** the command exits with `{"ok":true,"oldId":"E0001-bar","newId":"E0001-bar","noop":true}`
- **AND** no mtimes change

#### Scenario: Hypotheses substitution skipped when file does not mention the id
- **GIVEN** experiment `E0001-foo` exists and `docs/hypotheses.md`
  contains no `E0001-foo` token
- **WHEN** the user runs `memon experiment rename E0001-foo zero`
- **THEN** the rename succeeds
- **AND** `docs/hypotheses.md`'s mtime is unchanged (no write
  performed because content is unchanged)
