## MODIFIED Requirements

### Requirement: `memon run rename` only changes the slug

The CLI SHALL expose `memon run rename <run-id-or-dir> <new-slug>
[--project-root <p>]`. The command SHALL:
1. Locate the run dir (by exact dir name or by id).
2. Validate `<new-slug>` is `[a-z0-9-]+` and contains no timestamp suffix.
3. Compute the new dir name as `<new-slug>-<YYMMDD>-<HHMMSS>` reusing the
   run's existing timestamp.
4. Check that no other run in the project ALREADY HAS THE SAME DIR NAME
   (which can only happen if some other run has both this slug AND this
   exact timestamp suffix). On collision, exit with the `DUPLICATE_RUN_DIR`
   error code. Run slugs themselves MAY repeat across different
   timestamps — the timestamp suffix already disambiguates the dir
   name, so a slug-only check would reject legitimate reruns.
5. If the run has a parent experiment (`experiment:` field set), update
   that experiment's `runs[]` array atomically — replace the old dir name
   with the new dir name. If the run claims experiment `E_a` but `E_a`'s
   `runs[]` does NOT list this run (a `MISMATCH_EXPERIMENT_REF` anomaly),
   the rename SHALL fail with `BAD_STATE` and instruct the user to
   reconcile the binding first.
6. `git mv` (or `fs.rename`) the directory.
7. Update the run README's frontmatter `id` field to the new dir name.
8. Append a `[RENAME]` event to JOURNAL with body `{old, new}`.

The command SHALL NOT touch the run's timestamp suffix. It SHALL NOT
change `created_at` or `updated_at` (the rename is a naming op, not a
content edit). It SHALL NOT update the parent experiment's `updated_at`.

The command SHALL warn but not block if the soft prefix rule is violated
(experiment slug is a prefix of the new run slug). The warning is to
stderr; exit code 0.

#### Scenario: Rename updates experiment back-reference
- **GIVEN** a run `foo-260501-100000` with `experiment: E0001-foo` and
  `E0001-foo.runs: ["foo-260501-100000"]`
- **WHEN** the user runs `memon run rename foo-260501-100000 foo-baseline`
- **THEN** the dir is now `foo-baseline-260501-100000`,
  `E0001-foo.runs` is `["foo-baseline-260501-100000"]`, and a `[RENAME]`
  event is appended to JOURNAL

#### Scenario: Dir-name collision rejected
- **GIVEN** runs `foo-260501-100000` and `bar-260501-100000` exist
  (same timestamp, different slug)
- **WHEN** the user runs `memon run rename bar-260501-100000 foo`
- **THEN** the command exits with `DUPLICATE_RUN_DIR`, no filesystem
  changes occur

#### Scenario: Slug repeat across timestamps is OK
- **GIVEN** runs `foo-260501-100000` and `bar-260502-100000` exist
- **WHEN** the user runs `memon run rename bar-260502-100000 foo`
- **THEN** the command succeeds and the dir is now
  `foo-260502-100000` — the slug "foo" now appears twice in the
  project at distinct timestamps, which is allowed

#### Scenario: Anomaly state blocks rename
- **GIVEN** a run claims `experiment: E0001-foo` but `E0001-foo.runs[]`
  does not list it (a `MISMATCH_EXPERIMENT_REF`)
- **WHEN** the user attempts `memon run rename` on this run
- **THEN** the command exits with `BAD_STATE` and stderr names the
  anomaly; the user must reconcile via `memon experiment link/unlink`
  first
