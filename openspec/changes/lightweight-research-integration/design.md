## Context

See proposal.md. Companion changes introduce `format: "lightweight"` declarations, pure long-form aggregate CSV, and `run.json` with compatibility projections into existing Run DTOs. Production currently uses a frozen release, so source builds and browser verification can be isolated from its output.

## Goals / Non-Goals

Goals: complete one usable workflow, preserve old evidence, make metadata durable across Git synchronization, and reduce routine filesystem reads and agent-written boilerplate.

Non-goals: bulk project conversion, changing research classifications without instruction, monitor transport, or removing ordinary Git history. Particular deployments and selected pilot data remain local-only.

## Decisions

- Reuse the existing snapshot maps and protocol models. Add explicit JSON record metadata fields rather than pretending a JSON file is editable Markdown. Convert filesystem records at the backend boundary and render existing status/metadata components with format-aware actions. New JSON metadata is displayed read-only; source CLI owns lifecycle writes and their exports. Legacy website editing remains available.
- Lightweight Results use `generateLightweightResultsSummary` with the declaration and saved `variant,path,stat,value` CSV. Status comes from registered Run summaries, never inferred from the existence of metrics. `run.*` columns are explicit projections of metadata, not CSV management fields.
- Directory ownership replaces binding lists. A Run carries independent execution status and `active`; first creation defaults active when no active peer exists. Explicit replacement deactivates peers under the same writer lock. Variant IDs derive from inventory paths; display names and planned parameters derive from Run records. Do not persist a second selection/draft registry.
- Supported CLI lifecycle and result writes export metadata/parameters into the Run CSV, then publish the experiment CSV, then the index. Native measurements remain available; READY never contributes measured values. Failure after the primary record write is a non-success with a precise repair instruction, not a silent stale table. Browser reads never execute export scripts. A small ignored publication-error marker hides a previous table after failed/interrupted refresh until repair; the CSV itself stays unchanged and contains only data.
- Resume preparation retains the parameters associated with existing measurements. Changing executed conditions requires a new Run; `RESUME_READY` describes continuation of the same execution rather than relabeling old measurements. PENDING remains readable as an ambiguous legacy state, never automatically guessed into READY or QUEUED.
- Optional assessment reasons distinguish invalid measurements, limited precision and superseded methods; inactive or retired alone makes none of those claims. Imported README sections live under optional `legacy_sections` and remain readable as deprecated-format content, not invalid evidence.
- FS11 ordinary inventory uses the published snapshot. Writers merge events and compact under the existing lease. Keep explicit rebuild/refresh for external edits and a clear partial-write error for failed publication. Avoid a second registry or a remote database.
- Keep native configuration/log/output formats and extract only currently useful result fields. A scoped migration manifest records old/new paths, selected evidence and retained qualifications. Keep old path aliases for historical references, exclude aliases from canonical discovery, and avoid moving running directories. Keep unmigrated legacy experiments readable.
- Consolidate default research instructions around the natural work loop. Retain specialized components, migrations and optional investigation/development guidance only where useful; remove fixed coordination roles and duplicate procedural preflights. Legacy commands remain callable where needed but are not the default tutorial.

## Risks / Trade-offs

- Stale snapshots after direct edits → one explicit refresh operation, explained in CLI output and skills; no hidden background full scans.
- Old empty CSV files → preserve original artifacts and extract a small verified subset, rather than fabricating or requiring exhaustive migration of metrics.
- Duplicate Run basenames → use project-relative paths for inventory identity and reject ambiguous shorthand, while normal generated IDs remain unique.
- Legacy review and research metadata → retain meaningful historical limitations; remove the workflow machinery without declaring old measurements valid again.
- Breaking filesystem changes → ship the reviewed seven-section v10-to-v11 guide with explicit scoped verification and rollback; do not convert projects on deployment.

## Migration Plan

Validate on neutral fixtures and one locally selected pilot with a recoverable plan before changing source data. Keep legacy readers active. Publish the FS11 release only after targeted tests, typechecks, command smoke tests and rendered verification. Deploy an exact frozen revision; bulk migration remains a separate action. Git-based data rollback restores the scoped migration commit, and non-Git operation restores its backup.
