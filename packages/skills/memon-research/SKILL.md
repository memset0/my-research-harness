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
Read `.memon/index/experiments.json` for published inventory; run `refresh` after
direct document edits. Catalogs are ignored by Git and rebuilt at the source.
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
