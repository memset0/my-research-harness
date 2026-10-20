## Context

See proposal.md. Existing Results readers normalize JSON declarations and render one summary model; legacy research versions select historical evidence. New Run ownership is encoded by `logs/E<NNNN>/V<NNNN>/<runid>` and `logs/E<NNNN>/smoke/<runid>` in the companion Run change.

## Goals / Non-Goals

Goals: reuse column/group presentation and summary interfaces, support concise drafts and explicit evidence, preserve legacy behavior, and avoid Run reads during ordinary lightweight result viewing.

Non-goals: automatic project migration, general CLI/skill redesign, monitor transport, changing old research-version filtering, executing arbitrary scripts during reads.

## Decisions

- `format: "lightweight"` discriminates the new declaration, not an experiment epoch. Only presentation definitions and optional per-Variant aggregation settings live there; the normalized reader model can still use arrays internally. Variant IDs derive from indexed directory ownership, including a pre-created READY Run.
- No binding lists, names or drafts are required in experiment.json. Optional names, partial planned parameters, active flags and assessments belong to run.json. Unselected historical Runs remain associated by directory and are available for inspection.
- `aggregate: "aggregate_variant.py"` explicitly opts an ordinary Variant into custom aggregation. One experiment-local Python program accepts a JSON request on stdin containing Variant identity and active Run paths/results; stdout uses the existing `path,stat,value` Run result CSV without required version metadata. Stderr is diagnostic, execution is bounded, and arguments are never passed through a shell.
- The saved experiment table uses pure `variant,path,stat,value` rows. This is the Run CSV with a Variant key, preserves scalar/stat type distinctions and avoids lossy display strings or unrelated status/provenance columns. The existing human CLI export remains available as a projection.
- A content-only persisted reader converts rows to the existing summary model. Run inventory supplies optional display names and status; the declaration supplies column metadata. READY parameters are visibly planned and its metrics are excluded. Runtime status can be supplied by the project index without opening Run directories.
- Explicit `run.*` columns extract selected metadata from `run.json` (for example status, host, wandb or scheduler.job_id); they remain separate from actual params and metrics. Their default presentation partition is env.
- Aggregation validates every selected input and collects every Variant result before atomic replacement. The experiment declaration is fingerprint-checked before publication to avoid publishing against a concurrently changed selection.
- New FS11 Experiment creation writes a minimal README and lightweight `experiment.json`. Older filesystem versions retain their existing creation behavior and readers; optional old YAML files remain readable.

## Risks / Trade-offs

- Saved tables may lag external changes → CLI lifecycle writes refresh tables, with explicit rebuild for external edits; browser reads never silently regenerate.
- User-authored scripts run code → only explicit local CLI aggregation executes them; bounded output/time and contained script/input paths.
- Files may change during a lengthy aggregate → verify declaration and input fingerprints before replacement and preserve the previous file on conflict.
- Existing summary status is derived from Run facts → permit index-supplied facts and never infer successful execution from the existence of a saved CSV alone.

## Migration Plan

Ship alongside an explicit FS11 migration guide. Existing files remain readable, and any conversion is separately reviewed. Rollback retains the tracked source and saved results; older binaries cannot author the new declaration.
