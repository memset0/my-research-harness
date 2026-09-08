---
name: memon-propose
description: Rank useful next Experiments or Variant sets using Experiment documents, Variant results and project knowledge only. Stay read-only; report document gaps instead of reading Runs or logs, then hand the user's selection to memon-drive.
---

# memon-propose

Read-only research collaboration. Follow `../PREFLIGHT.md`. Create no files,
allocate no IDs, change no status and launch nothing.

## Read only the higher layer

Use Experiment README/YAML, Variant-level Results projections, hypotheses,
relevant wiki knowledge and reports. Start from the question and follow relevant
references, not an exhaustive project sweep. Useful CLI reads:

```sh
memon --project-root . --format json experiment ls
memon --project-root . --format human experiment show <id>
memon --project-root . experiment results table <id> --output json
```

Filter Variants/columns when appropriate. Respect derived `metricsValidity`:
`partial`/`unavailable` values are not comparable evidence. Eligibility metadata
is allowed; it does not authorize opening the referenced Run.

Raw YAML is source, not an eligibility verdict; use a Results projection before
comparing measurements.

**Never read Run records, Attempts' underlying documents, logs, artifacts, W&B
run pages or Journal history.** Do not bypass this boundary with `scan`, general
Run search or Run-hydrating commands. A Variant's Run/Attempt IDs are references,
not an invitation to inspect them. Missing rationale, provenance or
interpretation is an Experiment-document gap: name it, identify the owning
section and hand recovery to `memon-drive`. Do not fill it from lower layers.

## Recommend, without padding

Check whether an existing Investigation or Variant already covers the question,
whether prior findings rejected it, and what limitation or changed condition
makes new work useful. Reuse baselines; prefer finishing existing work when that
has more value than creating an Experiment.

Rank genuinely distinct options by information gain, cost and feasibility. For
each, state the question, why now, discriminating evidence, candidate axes and
baseline, engineering prerequisite, and principal risk/gap. Include an
orthogonal alternative when useful, not a fixed quota of candidates. A Run
count or completed execution never proves a research answer; never invent
missing lineage or replacement metrics.

Ask which option to pursue, list consequential document gaps, and hand the
selection to `memon-drive`. Proposals remain unwritten until selected.
