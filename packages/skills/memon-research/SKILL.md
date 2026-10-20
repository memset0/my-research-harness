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
- `experiment variant create <E-id> --params '<json>'` prepares a Variant's
  first READY Run. Use the returned path; do not create another draft registry.
- `run create --experiment <E-id> --variant V0001` creates another execution;
  use `--variant smoke` for program/environment checks.
- `run update <path>` records status, parameters, tracking links and optional
  explanations. `run result set <path> metrics.loss=0.2` records useful results.

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

CLI writes refresh `run.json → result.csv → results.csv` and the index.
Use `experiment results rebuild <E-id>` after manual extraction or direct edits.
Extract only useful fields; retain native evidence. `experiment.json` holds
presentation columns/groups and optional aggregation settings, not a second plan.

## Research explanation

Keep questions, cross-Run evidence, current conclusions and limitations together
in the Experiment README. Revise it when understanding changes; avoid per-Run
bullet logs. Independent technical explanations may go in `details/`.
Create implementation/investigation documents only on explicit request, using
`memon-structured-work`. Update Wiki when understanding or direction changes.

Inactivity and retirement do not imply invalid measurement. Use optional Run
assessments INVALID, LIMITED, SUPERSEDED or OTHER with a reason when needed.
Imported `legacy_sections` preserve old prose; do not maintain them for new Runs.
A fundamental redo gets a new E ID, not an experiment epoch. Change lifecycle
ACTIVE/PAUSED/ARCHIVED/RETIRED only within the owner's authorization;
RUNNING/COMPLETED are derived display states.
