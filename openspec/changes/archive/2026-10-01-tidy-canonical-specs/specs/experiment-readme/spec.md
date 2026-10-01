## MODIFIED Requirements

### Requirement: ExperimentStatus enum with uppercase canonical form and human-only writes

The `status` field on `ExperimentFrontMatter` SHALL be stored in uppercase canonical form, drawn from the `ExperimentStatus` enum: `OPEN` / `RESOLVED` / `ABANDONED`. Lowercase or mixed-case values surface a parse warning AND the in-memory value is normalised to uppercase. Out-of-enum values surface a structured error and the in-memory value defaults to `OPEN` (so the doc remains usable). Missing values default to `OPEN` per the schema requirement above.

The frontmatter SHALL hold only the bare enum string; no emoji or other prefix is part of the stored value. The Web UI SHALL render each value as an icon plus the enum string per `web-layout`'s "Status display uses colored Badge with lucide icon" requirement and SHALL NOT render a status emoji.

Semantic boundaries:
- `OPEN` — the investigation is in progress. Default for new experiments. Does NOT mean "currently running" — an experiment with all-FINISHED member runs that the user hasn't yet declared resolved is still `OPEN`. Use `OPEN` whenever the user has not yet asserted a terminal lifecycle decision.
- `RESOLVED` — the investigation reached its motivation. The user (or an agent acting on user instruction) has declared the experiment closed with a positive outcome.
- `ABANDONED` — the investigation closed without reaching its motivation. Used when the user has decided to stop pursuing the question, regardless of whether the runs themselves succeeded or failed. NOT a synonym for `FAILED` (which describes program errors, not lifecycle decisions).

`ExperimentStatus` SHALL be human-only: the discovery code, the orchestrating agent, the polling code, and the JSON API SHALL NOT auto-derive or auto-write this field. Only the explicit human-write paths (`memon experiment status set`, web status picker, doc hand-edit) may write the value.

#### Scenario: Lowercase normalized at parse
- **WHEN** an exp doc has `status: open`
- **THEN** the parser surfaces a parse warning AND the in-memory value is `OPEN`

#### Scenario: Out-of-enum value defaults to OPEN
- **WHEN** an exp doc has `status: closed`
- **THEN** the parser produces a structured error AND the in-memory value defaults to `OPEN`

#### Scenario: Resolution does not auto-derive from runs
- **GIVEN** an experiment whose 5 member runs all have `status: FINISHED`
- **WHEN** the discovery layer re-indexes the experiment
- **THEN** the experiment's `status` is unchanged from whatever the doc's frontmatter says (typically `OPEN`)
- **AND** re-indexing writes no status-change record or activity receipt as a side-effect

#### Scenario: Web renders an icon, never an emoji
- **WHEN** the Web UI renders an experiment with `status: RESOLVED`
- **THEN** the status shows an icon plus the text `RESOLVED`
- **AND** no status emoji appears in the rendered DOM

## REMOVED Requirements

### Requirement: Status enum with uppercase canonical form

**Reason**: This is the Run status enum (`PENDING`/`RUNNING`/`FINISHED`/`INTERRUPTED`/`FAILED`/`UNKNOWN`), duplicated from `run-readme`, and its "fixed emoji prefix" rendering rule contradicts the icon-based Web rendering in `web-layout`.
**Migration**: `run-readme` "Status enum with uppercase canonical form" is the single authoritative definition of Run status values, parsing and semantics; Web rendering is defined by `web-layout` "Status display uses colored Badge with lucide icon".
