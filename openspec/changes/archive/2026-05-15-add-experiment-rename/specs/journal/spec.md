## MODIFIED Requirements

### Requirement: New event tags for experiment, binding, and rename

The journal event grammar SHALL accept these new tags in addition to the v2 set:

- `[EXPERIMENT]` — emitted by `memon experiment create`, `memon experiment delete`, and exp-doc edits via the web UI. Body format: `` `<E-id>` op=<create|edit|delete> [extra-fields] ``. For `op=delete`, extra fields include the prior `runs[]` payload so the binding can be reconstructed if needed.
- `[BIND]` — emitted by `memon experiment link` / `memon experiment unlink` (also dispatched when the web UI's `Link to experiment` action runs). Body format: `` `<E-id>` op=<link|unlink> run=<run-dir-name> ``.
- `[RENAME]` — emitted by **either** `memon run rename` **or** `memon experiment rename`. The body format SHALL be a single line in one of two shapes:
  - Run-rename form: `op=run-rename old=<old-dir-name> new=<new-dir-name>`.
  - Experiment-rename form: `op=experiment-rename old=<old-E-id> new=<new-E-id>`.

The `[WARNING]` event continues from v2 with one schema change: the event body SHALL include a `run=<run-dir-name-or-null>` token to attribute the warning to a specific run when applicable.

#### Scenario: EXPERIMENT create event
- **WHEN** `memon experiment create zero-snr-fix` succeeds
- **THEN** JOURNAL.md gains one new line: `- <ISO> [EXPERIMENT] \`E0001-zero-snr-fix\` op=create slug=zero-snr-fix`

#### Scenario: BIND link event
- **WHEN** `memon experiment link E0001-zero-snr-fix bar-260501-100000` succeeds
- **THEN** JOURNAL.md gains one new line: `- <ISO> [BIND] \`E0001-zero-snr-fix\` op=link run=bar-260501-100000`

#### Scenario: RENAME event for run rename
- **WHEN** `memon run rename foo-260501-100000 baz` succeeds (foo → baz, timestamp preserved)
- **THEN** JOURNAL.md gains one new line: `- <ISO> [RENAME] op=run-rename old=foo-260501-100000 new=baz-260501-100000`

#### Scenario: RENAME event for experiment rename
- **WHEN** `memon experiment rename E0001-foo zero-snr-fix` succeeds (foo → zero-snr-fix, NNNN preserved)
- **THEN** JOURNAL.md gains one new line: `- <ISO> [RENAME] op=experiment-rename old=E0001-foo new=E0001-zero-snr-fix`
- **AND** the bound runs' READMEs each had their `frontMatter.experiment` rewritten to `E0001-zero-snr-fix`, but those rewrites SHALL NOT generate separate JOURNAL events — the single `[RENAME]` event covers the whole cascade

#### Scenario: WARNING event includes run attribution
- **WHEN** `memon experiment warning add E0001-foo --run bar-260501-100000 --category result --message "..."` succeeds
- **THEN** JOURNAL.md gains a `[WARNING]` line whose body includes `` `E0001-foo` op=add rowId=<id> run=bar-260501-100000 category=result message="..." ``

#### Scenario: WARNING event for exp-scoped warning has run=null
- **WHEN** the same command runs without `--run`
- **THEN** the `[WARNING]` event body includes `run=null` (or the literal token `null`, depending on serializer)
