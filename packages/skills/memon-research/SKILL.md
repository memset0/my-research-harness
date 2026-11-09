---
name: memon-research
description: Create, run and analyze memon experiments; maintain their evidence and conclusions.
---

# Research

Read `../PREFLIGHT.md` once. Work from the research question: write code, execute
within the authorized resources, analyze native outputs, and update conclusions.

## Files and commands

Commands below use `memon --project-root .`:

- `experiment create <slug>` creates `README.md` and `experiment.json`.
- `run create --experiment <E-id> --params '<json>'` allocates a Variant and its
  READY Run; use the returned directory. Add `--variant V0001` for another Run
  of that Variant, or `--variant smoke` for program/environment checks.
- `run update <path> --status RUNNING` maintains execution state and timestamps.
- Edit documents, metadata and result files directly; `refresh <E-id>` publishes
  the changes. Metrics use `path,stat,value` rows in the Run's `result.csv`.
- `show` reads inventory; `show <E-id|run-path>` reads a record and `--results`
  reads its results. JSON is the default; `--include-history` includes old records.

Run creation records a plan; it does not launch a process. Before reusing a
launcher, check that it uses the allocated directory and current Run metadata.
Do not bypass an obsolete-convention guard: discuss upgrading with the user,
then verify the authorized upgrade before launching.

Ownership comes from `logs/E0001/V0001/<runid>/` or `logs/E0001/smoke/<runid>/`.
`run.json` holds execution facts; no Run README or binding list is needed.
READY means prepared, QUEUED means submitted, and RESUME_READY means prepared
continuation. Other states are RUNNING, FINISHED, FAILED, INTERRUPTED and UNKNOWN;
legacy PENDING remains ambiguous. READY parameters are plans, not measurements.
Resume preserves identity and the actual conditions of existing measurements.

`active` independently selects evidence. The first Run is active; use
`--activate` to replace it or `--active false` to retain only its history.
Default aggregation permits at most one active Run per ordinary Variant;
smoke never contributes formal results. For multiple inputs or custom logic,
read [aggregation.md](aggregation.md). Optional names live on the Run.

CLI writes refresh `run.json → result.csv → results.csv` and the Experiment catalog.
After direct edits follow the preflight Published index steps: `refresh <E-id>`
for changed results or records and plain `refresh` for the catalogs. Read
`.memon/index/experiments.json` for published inventory.
Extract only useful fields; retain native evidence. `experiment.json` holds
presentation columns/groups and optional aggregation settings, not a second plan.

## Research explanation

Keep the question, comparison, selected evidence, current interpretation and
meaningful limits understandable from the Experiment README without reading the
chat. Link native evidence or visual reports; no fixed headings or copied result
tables are required. Revise when understanding changes, not after every Run.
Independent technical explanations may go in `details/`; no manual project roster.
Create implementation/investigation documents only on explicit request, using
`memon-structured-work`. Update Wiki when understanding or direction changes.

Inactivity and retirement do not imply invalid measurement. Use optional Run
assessments INVALID, LIMITED, SUPERSEDED or OTHER with a reason when needed.
Imported `legacy_sections` preserve old prose; do not maintain them for new Runs.
A fundamental redo gets a new E ID, not an experiment epoch. Change lifecycle
ACTIVE/PAUSED/ARCHIVED/RETIRED only within the owner's authorization;
RUNNING/COMPLETED are derived display states.

## Decisions through discussions

When the user needs to choose among proposals or answer research questions,
author `docs/discussions/D<NNNN>-<slug>/README.md`. Create it with
`memon --project-root . discussion create <slug> --title "Discussion title"`.
Keep DRAFT while preparing it; publish only when ready with
`memon --project-root . discussion status D0001 --status OPEN`.

Place a fenced `question` block immediately after each question heading:

````markdown
## Where should results live?

```question
id: RESULT-STORAGE
type: choice
category: storage
status: OPEN
options:
  - id: files
    label: Project files
  - id: central
    label: Central storage
prefer:
  option: files
  reason: Keep evidence portable.
```

Explain the proposal and its evidence here. Use tables, images, HTML and
existing components freely. Choose categories together with the user.
````

Use choice, multi, confirm or text. Keep question IDs stable and uppercase with
digits/hyphens. Confirm preferences use booleans; multi preferences use option
arrays. The owner responds on the website. Read feedback with
`memon --project-root . discussion pending` and inspect the full history with
`memon --project-root . discussion show D0001`. Reply with
`memon --project-root . discussion reply D0001/RESULT-STORAGE "Reply text"`.
After acting on captured feedback, resolve it with
`memon --project-root . discussion resolve D0001/RESULT-STORAGE --status DECIDED --decision files --note "Adopted and implemented"`.
For multi decisions pass a JSON array; for confirm pass true or false. OPEN,
DEFERRED and DROPPED are also valid question statuses. Preserve qualifications
and unresolved work rather than fabricating consensus.

Run plain `memon refresh` after direct author edits. README holds all questions;
responses.jsonl is append-only owner responses and agent replies/acks. Never
rewrite that history. Discussion lifecycle is DRAFT/OPEN/CLOSED, separate from
question processing; closing does not imply every question was resolved. The
owner can close/reopen published discussions in the browser. Changes to titles,
options or descriptions require renewed feedback; recategorization and state
updates preserve answer validity. Reuse existing content only after a deliberate
per-project decision; do not automatically convert old Reports.
