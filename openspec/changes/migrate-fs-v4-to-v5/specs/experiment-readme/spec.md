## MODIFIED Requirements

### Requirement: Experiment doc location and front matter schema

Each experiment SHALL be described by a single markdown file at
`<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md` where `<NNNN>` is a
4-digit zero-padded integer in `0001..9999` and `<slug>` is a kebab-case
string `[a-z0-9][a-z0-9-]*[a-z0-9]`. The file SHALL begin with a YAML
front matter block bounded by `---` lines.

The enclosing folder `E<NNNN>-<slug>/` is an **experiment-local scratch space**. Any file or subdirectory inside the folder other than `README.md` is owned by the user (typically: smoke-run scripts, sbatch templates, multi-launch helpers, ad-hoc analysis figures). memon SHALL NOT scan, index, modify, validate, or auto-discover those files. Only `README.md` is touched by parsers and writers.

Required front matter fields:
- `id` (string) — must equal the folder's `E<NNNN>-<slug>` portion
- `slug` (string) — must equal the slug portion of the folder name (the part
  after `E<NNNN>-`)
- `title` (string) — human-readable name
- `status` (`ExperimentStatus`) — manually-set lifecycle state. Enum: `OPEN` / `RESOLVED` / `ABANDONED`. Default `OPEN`. Human-only write (the orchestrating agent and discovery code SHALL NOT write this field on their own).
- `archived` (boolean) — per `archive-frontmatter`. Default `false`.
- `created_at` (ISO8601 with timezone offset) — when the doc was first
  written
- `updated_at` (ISO8601 with timezone offset) — bumped on every web/CLI
  edit; SHALL NOT be auto-rewritten by the parser

Optional front matter fields:
- `runs` (array of strings) — run dir base names (e.g.
  `["zero-snr-260502-110000"]`). Each element SHALL match the run dir
  regex `^.+-\d{6}-\d{6}$`. Elements that don't match SHALL be dropped
  from the parsed array with a structured warning
  `code: 'INVALID_RUN_REF'`.
- `hypotheses` (array of strings) — `H<NNNN>` IDs (4-digit zero-padded);
  invalid elements surface `INVALID_HYPOTHESIS_REF` and are dropped, the
  rest of the array stays.
- `tags` (array of strings)

Removed/disallowed fields: `project` is NOT a frontmatter field on
experiment docs (project membership is derived structurally from
`config.yml`'s project roots, the same as runs).

Canonical key order in the YAML output: `id`, `slug`, `title`, `status`, `archived`, `runs`, `hypotheses`, `tags`, `created_at`, `updated_at`. Other orders are tolerated by the parser but the serializer SHALL emit this order.

#### Scenario: Valid front matter parses
- **WHEN** an exp doc at `docs/experiments/E0001-foo/README.md` contains all required fields including `status: OPEN` and `archived: false`
- **THEN** the parser produces a fully populated experiment record with no warnings

#### Scenario: id mismatch with folder name
- **WHEN** the folder is `E0001-foo/` but `README.md`'s front matter says `id: E0002-foo`
- **THEN** the parser surfaces an `ID_FILENAME_MISMATCH` error and the index entry uses the folder-derived id

#### Scenario: Invalid run reference dropped
- **WHEN** `runs: [zero-snr-260502-110000, totally-invalid-name]`
- **THEN** the parser stores `["zero-snr-260502-110000"]` and surfaces an `INVALID_RUN_REF` warning naming the dropped element

#### Scenario: Missing status field defaults to OPEN with parse warning
- **GIVEN** an exp doc whose frontmatter lacks the `status:` key
- **WHEN** the parser reads the doc
- **THEN** the in-memory `frontMatter.status` is `'OPEN'`
- **AND** the parser surfaces `code: 'MISSING_EXP_STATUS', severity: 'warning'`

#### Scenario: Missing archived field defaults to false with parse warning
- **GIVEN** an exp doc whose frontmatter lacks the `archived:` key
- **WHEN** the parser reads the doc
- **THEN** the in-memory `frontMatter.archived` is `false`
- **AND** the parser surfaces `code: 'MISSING_ARCHIVED_FIELD', severity: 'warning'`

#### Scenario: Legacy file-form layout detected during migration window
- **GIVEN** the project is mid-migration: marker still at 4 OR migration hasn't run yet, and an exp doc exists at `docs/experiments/E0001-foo.md` (legacy v4 file form)
- **WHEN** the parser scans `docs/experiments/`
- **THEN** the parser surfaces a `LEGACY_LAYOUT` warning naming `memon-migrate-fs` as the resolution path
- **AND** the doc's content is still parsed so the user can continue working in read-only mode while waiting to migrate

#### Scenario: Folder name collision detected
- **GIVEN** the migration is about to move `docs/experiments/E0001-foo.md` into a folder, but `docs/experiments/E0001-foo/` already exists as a sibling (user-created scratch)
- **WHEN** the migration script reaches this entry
- **THEN** the migration HALTS with a `MIGRATION_COLLISION` message naming both paths and asking the user to resolve manually
- **AND** no `git mv` is run for the colliding entry

## ADDED Requirements

### Requirement: Parser emits `UNKNOWN_H2_SECTION` warning for non-canonical H2 headings

The experiment-doc parser SHALL emit a `parseWarnings` entry of `code: 'UNKNOWN_H2_SECTION'` whenever it encounters an H2 heading whose normalized text is not in the canonical list (`Motivation`, `Method`, `Plan`, `Conclusion`, `Caveats`, `Warnings`). The body following the unknown heading SHALL be preserved verbatim in the parsed `body` field, but is not exposed as a typed section.

The warning record SHALL include the heading text and the source line number so downstream consumers (doctor pass, digest sweep, web `parse_warnings` panel) can surface the heading and offer the user a path to resolve (rename to canonical, drop the content, or accept the warning as intentional).

#### Scenario: Unknown H2 in exp doc surfaces warning
- **GIVEN** an exp README containing `## Findings` (not in canonical list)
- **WHEN** the parser reads it
- **THEN** `parseWarnings` includes `{ code: 'UNKNOWN_H2_SECTION', severity: 'warn', heading: 'Findings', line: <n>, ... }`
- **AND** the body content under `## Findings` is preserved verbatim in `body`
- **AND** none of `sections.motivation` / `sections.method` / etc. is populated from the unknown section

#### Scenario: Multiple unknown H2s each get a warning
- **GIVEN** an exp README containing `## Findings` AND `## Notes`
- **WHEN** the parser reads it
- **THEN** `parseWarnings` contains two separate `UNKNOWN_H2_SECTION` entries — one per heading — with distinct `heading` values
