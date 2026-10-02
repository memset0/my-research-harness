## MODIFIED Requirements

### Requirement: Sources resolve to project artifacts and drive staleness

Each `sources` entry SHALL be resolved as one of: an Experiment id `E<NNNN>` optionally followed by `-<slug>`; a Variant inside an Experiment, `E<NNNN>[-<slug>]/V<NNNN>`, which resolves only when that Variant is declared in the Experiment's description file `experiment.json`; a Hypothesis id `H<NNNN>`; a wiki page id `W<NNNN>`; or a run directory base name. For a resolved source the system SHALL determine its last-change time: Experiment effective updated time (also for Variant form), Hypothesis file modification time, cited page `updated_at`, run `updated_at` (README mtime when absent). A page SHALL be `stale` when at least one resolved source changed after the page's `updated_at`; the list projection SHALL expose `stale` and `staleSources` (the offending entries in declaration order). An unresolvable entry SHALL produce `WIKI_SOURCE_UNRESOLVED` (`warn`) and SHALL NOT contribute to staleness. A `finding` whose Markdown body contains no `E<NNNN>`, `V<NNNN>`, or run directory token SHALL produce `WIKI_CLAIM_WITHOUT_EVIDENCE` (`warn`) even when `sources` is non-empty.

#### Scenario: Cited experiment moved on
- **GIVEN** page `W0004` with `updated_at: 2026-09-01T10:00:00+08:00` citing `E0017`, and `E0017`'s effective updated time is `2026-09-03T09:00:00+08:00`
- **WHEN** the wiki is listed
- **THEN** `W0004` has `stale: true` and `staleSources: ["E0017"]`

#### Scenario: Fresh page
- **GIVEN** a page whose every source changed before its `updated_at`
- **WHEN** the wiki is listed
- **THEN** the page has `stale: false` and empty `staleSources`

#### Scenario: Unknown source is a warning
- **GIVEN** a page citing `E9999`
- **WHEN** the wiki is listed
- **THEN** the page carries `WIKI_SOURCE_UNRESOLVED` and `E9999` is absent from `staleSources`

#### Scenario: Variant source resolves through its experiment
- **GIVEN** a page citing `E0017/V0068` and `E0017`'s `experiment.json` declares Variant `V0068`
- **WHEN** the wiki is listed
- **THEN** the source resolves, no diagnostic is produced, and staleness uses `E0017`'s effective updated time

#### Scenario: Missing variant is unresolved
- **GIVEN** a page citing `E0017/V0999` and no such Variant exists
- **WHEN** the wiki is listed
- **THEN** the page carries `WIKI_SOURCE_UNRESOLVED` for `E0017/V0999`

#### Scenario: Finding body without evidence tokens
- **GIVEN** a `finding` with `sources: [E0017]` whose body mentions no Experiment, Variant, or run identifier
- **WHEN** the page is linted
- **THEN** a `WIKI_CLAIM_WITHOUT_EVIDENCE` warning is produced
