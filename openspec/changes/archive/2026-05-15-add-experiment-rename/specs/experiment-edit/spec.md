## ADDED Requirements

### Requirement: memon experiment rename cascades the new slug through exp, runs, and hypotheses

The CLI SHALL expose `memon experiment rename <id-or-slug> <new-slug> [--project-root <p>]`. The core library SHALL expose `renameExperiment(projectRoot, projectName, oldIdOrSlug, newSlug, options?): Promise<RenameExperimentResult>` as the underlying primitive. The command and the helper SHALL:

1. Validate `<new-slug>` against `^[a-z0-9][a-z0-9-]*[a-z0-9]?$` and reject `BAD_REQUEST` when it includes a trailing `-<YYMMDD>-<HHMMSS>` timestamp tail (the same SLUG_RE shape `memon run rename` uses).
2. Resolve `<id-or-slug>` to a canonical `E<NNNN>-<slug>` via `resolveExperimentId`. On no match, exit with `NOT_FOUND`.
3. Compute the new canonical id: `newId = E<oldNNNN>-<new-slug>` (the `NNNN` is preserved; only the slug part changes).
4. Treat `new-slug === old-slug` as a noop and return `{ ok: true, oldId, newId: oldId, noop: true }` without touching disk.
5. Refuse with `EXPERIMENT_SLUG_PREFIX_COLLISION` when another existing experiment has slug equal to `new-slug`, OR when `new-slug` is a prefix of another experiment's slug or vice versa (same uniqueness rule as `memon experiment create`).
6. On a v5 record, rename the experiment folder from `docs/experiments/<oldId>` to `docs/experiments/<newId>` via `fs.rename`. On the legacy v4 file form (`exp.path` ends in `<oldId>.md`), rename the single `.md` file to `<newId>.md`.
7. Open the post-rename README, set `frontMatter.id = newId`, `frontMatter.slug = new-slug`, `frontMatter.updated_at = nowIso()`, and atomic-write the re-serialized content.
8. For each id in the exp doc's `frontMatter.runs`, resolve the run via `scanProjectRoot`. When the run's `frontMatter.experiment` equals `oldId`, rewrite it to `newId` (bumping `updated_at`); leave unrelated mismatches alone.
9. Read `<projectRoot>/docs/hypotheses.md` and perform a token substitution of `oldId` → `newId` over the body. The substitution SHALL use word-boundary semantics (`\bE\d{4}-[a-z0-9-]+\b`) so that `oldId` cannot match a substring of an unrelated longer token. The atomic-write SHALL be skipped when the file content is unchanged.
10. Append one `[RENAME]` event to `docs/journal.md` with body `op=experiment-rename old=<oldId> new=<newId>`.

The command SHALL emit JSON on stdout: `{ ok: true, oldId, newId, noop?: true, warnings?: [...] }`. Soft warnings (e.g. a member run whose slug doesn't start with `new-slug`) SHALL appear both as one-line `{warning:{code,message}}` JSON events on stderr AND inside the stdout `warnings` array.

The command SHALL NOT roll back on partial failure. The validate-first posture catches every recoverable error before any disk mutation; if a later step fails (e.g. permission denied on a run README write), the user resolves manually via git and re-runs (the operation is idempotent on already-renamed input).

#### Scenario: Successful rename rewrites exp folder, bound runs, and hypotheses
- **GIVEN** a project root with:
  - Experiment folder `docs/experiments/E0001-foo/README.md` with `frontMatter.runs = ['foo-260501-100000', 'foo-260502-110000']`
  - Two bound runs `foo-260501-100000/README.md` and `foo-260502-110000/README.md`, each with `frontMatter.experiment = 'E0001-foo'`
  - A hypothesis in `docs/hypotheses.md` with `**Experiments**: E0001-foo` in its body
- **WHEN** the user runs `memon experiment rename E0001-foo zero-snr --project-root <root>`
- **THEN** stdout is `{"ok":true,"oldId":"E0001-foo","newId":"E0001-zero-snr"}`
- **AND** the folder `docs/experiments/E0001-zero-snr/` exists; `docs/experiments/E0001-foo/` does not
- **AND** the new folder's `README.md` frontmatter has `id: E0001-zero-snr`, `slug: zero-snr`, and `updated_at` bumped
- **AND** both bound runs' READMEs have `experiment: E0001-zero-snr` (updated atomically)
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
