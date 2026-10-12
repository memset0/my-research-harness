## Context

See proposal.md for the problem and approval boundary. The baseline is FS9: Experiment README owns membership, `experiment.json` holds an array of Variants and a result-schema version, and each Variant's `runs` lists associations. `result.csv` holds actual measurements. Description parsing accepts unknown keys. Summary generation currently validates every member result file before excluding deprecated Runs, and can fill missing cells from frozen historical values.

Adding optional research-version fields would be unsafe: an old reader ignores them and still aggregates historical results. The project FS marker is not a sufficient old-reader barrier: the existing backend Results read does not universally reject an ahead marker. The adjacent active `run-results-v9` change describes the baseline; its schema/summary rules continue to govern FS9 only where the FS10 rules below differ.

## Goals / Non-Goals

**Goals:** preserve history and stable identities while separating current evidence, provide one shared eligibility decision across surfaces, and make a version transition one reviewable atomic document mutation.

**Non-Goals:** select which existing scientific results are wrong; execute or duplicate research; reorganize any research project's documents; infer protocol versions from names; tamper-proof arbitrary manual filesystem edits; automatically migrate project data when the software updates.

## Decisions

### 1. FS10 description shape

Use a natural ID-keyed Variant registry. Existing FS9 Zod readers require an array, so this shape fails parsing instead of silently showing an unsafe result table. Keep result schema and research version separate:

```json
{
  "experiment_schema_version": 1,
  "research": {
    "current_version": 2,
    "versions": [
      {
        "version": 1,
        "started_at": "2026-10-01T09:00:00+08:00",
        "reason": "Initial research version",
        "closed_at": "2026-10-02T09:00:00+08:00",
        "superseded_reason": "The comparison protocol used an incomplete timing boundary",
        "snapshot": {
          "experiment_schema_version": 1,
          "groups": {},
          "columns": [],
          "variants": {
            "V0001": { "name": "baseline", "values": {}, "runs": ["logs/trial-261001-100000"] }
          }
        }
      },
      { "version": 2, "started_at": "2026-10-02T09:00:00+08:00", "reason": "Corrected timing protocol" }
    ],
    "run_versions": { "logs/trial-261001-100000": 1 }
  },
  "groups": {},
  "columns": [],
  "variants": {
    "V0001": {
      "name": "baseline",
      "values": {},
      "runs": ["logs/trial-261001-100000"],
      "deprecated": false
    }
  }
}
```

The key is the stable Variant ID; no redundant mutable `id` is serialized inside the value. Preserve insertion order and unknown user fields. Version numbers are contiguous positive integers, current is the last entry, all earlier entries are closed and carry a definition snapshot. Snapshots retain declared values, provenance, deprecation, Variant associations, groups, columns, frozen provenance and schema version, not copied Run measurements. The snapshot has no recursive `research` field. Historical actual values always come from original Run files.

`run_versions` is an Experiment-local immutable attribution registry covering all current README members, including members without a Variant. Removed memberships leave registry tombstones, and snapshots retain prior associations. An attribution is not membership: it cannot resurrect an unlinked Run. A path in this registry cannot be reassigned to another version. Run rename atomically changes references to the same execution and preserves the attribution; it is not reenrollment.

This is deliberately not a `$research_version` row in `result.csv`: Run files remain execution facts, Experiment declarations remain ownership authority, and advancing one Experiment does not rewrite every Run. Do not overload `experiment_schema_version` or external protocol labels.

### 2. Version advance and deprecation

One shared mutation takes expected mtime and hash of `experiment.json`, expected current research version, and a nonempty reason. Under the existing common-writer coordination, it reads/rechecks README membership, rejects unregistered members or an inconsistent description, snapshots current definitions, closes the old version, appends the next, and atomically replaces the description. It never changes the Run registry, Run status, Run files, Variant IDs, or result schema. Current definitions carry forward for editing; their older `runs` remain associated but contribute no current evidence. Any current frozen values are captured in the closing snapshot and removed from the current definition, so absence of fresh data cannot expose old metrics as a fallback.

Variant deprecation is separate: `deprecated: true` requires `deprecation: {reason, deprecated_at, successor?}`. The optional successor is an existing different Variant ID in the same Experiment; reject cycles. Support an explicit restore operation with a reason and retained deprecation history, without changing Run research versions or restoring excluded generations. Planned/effective lifecycle states remain distinct from deprecation and Run execution status.

Generic description edits cannot modify the version ledger, existing Run attribution, historical snapshots, or deprecation audit metadata. They may edit current Variant definitions and normal columns. A Variant referenced by any retained Run or historical snapshot cannot be deleted; use deprecation instead. An unused plan with no Run, history or successor references can still be removed. Previously used IDs cannot be deleted and recycled into a different identity. Successors can later be deprecated themselves; existence and acyclicity, not active status, govern references. All supported writers enforce these comparisons against disk, not only specialized commands. Invalid manual files fail closed with targeted diagnostics; cryptographic prevention of arbitrary filesystem edits is outside scope.

### 3. Register actual executions without creating promotion loopholes

Integrate current-version registration into controlled Run creation/recording paths when the Experiment is specified. Capture the current version at execution creation, not at completion; a Run completing after a transition remains in its original version. Continuing the same Run keeps attribution. A new Run that actually executes under the new protocol can reference old artifacts as lineage, but cannot be merely a copied old result with a new version label.

Existing linking/association flows reuse a registered attribution; they never assign the current version just because a Run was linked today. Controlled creation enrollment and Experiment membership use a shared writer lock and compare/recheck both documents. Publish attribution before membership; an interruption can leave an unused attribution tombstone, never an eligible unversioned member. A race with advance aborts with conflict or retains the pre-transition attribution; it never silently promotes the execution.

An unregistered existing Run requires explicit import with a stated historical version and reason. Ordinary imports cannot target the current generation after an advance, even if `created_at` appears recent. The explicit initial FS migration can import existing members into version 1; domain-specific recovery of other historical boundaries requires its own reviewed migration. An optional Variant ID on historical import restores the association in that closed snapshot only when the Variant already existed there; it cannot invent a past definition. Linking without enrollment must not produce usable current evidence. Keep existing safe creation/record workflows convenient; do not invent a generic `set-version` escape hatch.

### 4. Eligibility before aggregation and validation

Centralize eligibility: current membership, Variant association, current research version, nondeprecated Variant, nondeprecated Run, and `FINISHED` execution status are all required for current measured values. Apply research-version scope before current-run result-schema validation and planned-value comparisons. Current-scope schema errors continue to fail visibly; malformed older files produce history diagnostics and never block unrelated current evidence. Membership/ledger integrity errors still fail closed.

Old RUNNING/FAILED/FINISHED states cannot drive a current Variant's effective state. Deprecation is an explicit overlay, not a new execution state. Current planned values remain visible with no new evidence, but prior frozen statuses/metrics cannot revive completion or rankings. Preserve archived Runs as research-eligible when otherwise eligible, matching their separate existing archive semantics.

History selects one closed version's snapshot and original Run data. Never mix versions in an aggregate, compare old data against the present definition, or fill missing historical values from current plans. If a historical file cannot be interpreted under its saved schema, show its raw values and a diagnostic rather than reinterpret it. Details expose exclusion reason and lineage; selected historical evidence remains excluded from current decisions.

### 5. API, CLI, Web, and supporting writers

Add CLI `experiment version show`, `experiment version advance --reason`, and explicit historical enrollment; add `experiment variant deprecate/restore` with reason and optional successor for deprecation. Shared core mutations support backend actions and Web controls with the same validation and CAS semantics (CLI exit 9 / HTTP 409). Return new lock tokens and affected eligibility/version metadata. Existing owner/viewer authorization and path containment apply unchanged.

Results reads take an optional historical version selector; omitted means current. Extend strict backend wire schemas and DTOs together. Web shows the current version/reason, a separate history entry, and Variant deprecation reason/successor. Provide advance and deprecate/restore controls with explicit consequence text. History display is independently selectable from deprecated-Variant visibility and existing Run-deprecated visibility. User Views and force-show rows cannot reinstate eligibility; filter before SOTA/ranking. Deep links can expose a historical Run with its exclusion clearly labeled. Experiment list `runCount` still counts all declared members.

Description changes invalidate results by fingerprint. Add version selection and summary contract version to cache identity; reusing a current summary for historical reads is forbidden. Include README membership fingerprint/rechecks where needed, and keep supported derived indexes rebuildable. A prior cache must not bypass the new description shape or eligibility rules.

Audit all writers: membership/unlink, Run/Experiment rename, generic document writes, annotations, schema upgrade, import, and result collection. Run rename updates active and historical references plus tombstones with existing safe-mutation recovery semantics; Experiment rename preserves local registry keys and IDs. FS10 result-schema upgrades act on the current generation and current definitions only, leaving closed snapshots and earlier result files unchanged; preview reports this scope. FS9 retains its existing all-member behavior. A schema upgrade never advances research version or makes historical evidence current.

### 6. Compatibility and explicit conversion

FS10 tooling accepts legacy FS9 arrays in an explicitly labeled legacy mode, preserving existing reads and writes without inferring scientific validity beyond existing deprecation/frozen rules. Legacy serializers retain arrays and existing semantics; they never inject research metadata. Existing Wiki, README, Run lifecycle, creation/record/link, results writes, annotations, rename and schema upgrade operations remain available in FS9 mode. Only the new research-version and Variant-deprecation operations require explicit FS10 migration. Their immutable-attribution guarantees begin at FS10 initialization, not retroactively in legacy mode. Software deployment and reads do not rewrite source files. New Experiment creation reads the project marker only to choose FS10 initialization versus the legacy array shape; this is not a global gate on existing writers. Missing markers or mixed shapes require diagnosis, not guessed enrollment.

The FS9-to-FS10 conversion retains IDs/order, custom fields, all memberships, `frozen` values and `frozen.attempts`, and all Run files. It converts the array to an object and registers every existing member in an initial version with a migration timestamp and an explicit initialization reason, not an invented historical start time. Frozen values are scoped to initial version 1. `frozen.attempts` stay historical non-evidence; do not append them to effective `runs`. Existing duplicates or contradictory ownership abort rather than guess.

No existing project is automatically scientifically divided into several versions: that needs separate evidence review. Conversion preserves default behavior where source data is valid and only introduces an initial version. The converted map shape makes unmodified FS9 readers reject the description even without a marker gate. New tool errors explicitly name unsupported FS and the needed upgrade. Compatibility tests run the previous array-only parser against a representative FS10 file and verify no success table or stale cache is served.

### 7. Experiment lifecycle refinement within FS10

The approved refinement extends the same FS10 change and ships as the next v10 distributed release. Store only ACTIVE, PAUSED, ARCHIVED or RETIRED on migrated Experiment READMEs. PAUSED means intended work is temporarily held; ARCHIVED means the current phase needs no further work while remaining relevant; RETIRED means the architecture/method/direction is no longer pursued. Do not persist derived RUNNING or COMPLETED. Experiment lifecycle never changes scientific evidence eligibility or Run execution state.

Display non-ACTIVE lifecycle values directly. For ACTIVE, show RUNNING when a required current-generation Variant has an actual RUNNING Run; otherwise show COMPLETED when a nonempty set of required Variants is all COMPLETED under existing Variant semantics; otherwise ACTIVE. Deprecated and DROPPED Variants are not required. Old-generation Runs/frozen states cannot drive this projection. Empty plans, blocked/planned/inconclusive work, and only PENDING/INTERRUPTED Runs must not manufacture completion or running activity. This change does not redesign Variant completion criteria or Run states. Progress reads current definitions and member execution facts, not result CSVs; CSV/Results errors remain independently visible. Current initial-version frozen completion is retained, while advancing removes that fallback. A separate running-Run count can warn about executions still running under PAUSED/ARCHIVED/RETIRED, including retained historical executions.

Expose stored lifecycle and display status separately in shared Core projections and strict wire/DTOs. Use the same projection for list, detail, filters and badges; the picker offers only the four writable values. There is no independent FS10 Experiment archived boolean or toggle; compatibility archive/unarchive operations map to ARCHIVED/ACTIVE. Run archive behavior remains unchanged. Generic README/status writers reject derived statuses and contradictory lifecycle/archive fields, preserve mtime/hash conflicts, and retain the explicit-human-decision policy.

FS9 parsing/serialization and original statuses remain readable/writable without silent conversion. FS10 creation writes ACTIVE without an archived flag. Existing FS10 documents from the initial v10 release can be explicitly normalized by the lifecycle migration. The v9-to-v10 guide and executor accept an explicit per-Experiment lifecycle map; uncertain legacy cases require a reviewed choice. The conversion changes only Experiment frontmatter plus the previously specified description/marker conversion, preserves bodies and Run bytes, and backs up exact source. Deploy new readers before changing project statuses. Existing value-type mismatches and declared members without a Variant are retained as explicit migration diagnostics, compared by full identity before/after; do not coerce values or invent associations to clear unrelated legacy lint. Structural and ownership errors still block. Rebuild the derived index after source conversion. Real-project mapping evidence and any unresolved judgments remain outside this generic repository.

## Risks / Trade-offs

- A breaking format requires deployment coordination → FS10 planning approval precedes implementation; migration is explicit and separate from tool deployment, with verified backups and rollback.
- Multiple current writers can race with enrollment/advance → common locks, mtime-plus-hash checks, membership rechecks, and attribution-first writes; test interrupted enrollment and concurrent advance.
- Version snapshots duplicate definitions → copy definitions only on a version transition, never metric payloads or Run prose.
- ID-keyed Variants affect many writers → regression coverage for annotations, schema upgrades, renames, import, passthrough and ordering; do not treat Zod parsing alone as compatibility.
- Historical files can predate the current schema → per-version display and raw diagnostics; no forced upgrade or current comparison.
- Manual file edits can fabricate history → supported writers reject ledger rewrites, lint exposes inconsistencies; source control and review remain required for manually authored migrations.

## Migration Plan

1. Obtain review of this breaking FS10 contract before code edits or release-number changes. Planning approval is not project-data migration approval.
2. Implement and test core, CLI/backend, Web and skills as one coherent feature. Author `packages/core/migrations/v9-to-v10.md` in the required seven-section format with executable checks, backup/rollback instructions and edge cases; do not run it against research data.
3. Validate release metadata for FS10 / initial release 10.0.0 only after approval and feature gates. The repository's version-major invariant requires coordinating FS constant and release metadata; do not leave a runnable mismatched pair between release steps.
4. Complete the normal verified release and deploy without another publication approval or converting existing projects. Existing FS9 read/write behavior remains available; only enabling the new research operations waits for separately approved migration.
5. For each separately approved migration, preview exact changes, preserve Run/result bytes, convert all bundles, verify associations and eligibility, then finalize the FS marker. On failure restore backups; do not lower only the marker on FS10 content. The guide uses the fixed migration commit subject `chore(memon): migrate FS convention v9 -> v10`.

No implementation or operator migration is performed by these planning artifacts.
