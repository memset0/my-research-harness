## Context

See proposal.md (Why). State this design builds on (7.4.0 plus the two changes it depends on, `bounded-run-discovery` and `central-read-path-trimming`, now archived into the canonical specs):

- `packages/backend/src/read-index.ts` (`ProjectReadIndex`) keeps per-Project entries keyed by what they observe (`run:<dir>`, `file:<abs>#<parser>`, `dir:<abs>`, `real:<abs>`, the walk), each with a stat fingerprint (dev, ino, size, mtimeMs, ctimeMs) and `validatedAt`; `observe(key, maxAge, fingerprint, load)` reuses an entry inside its window, re-fingerprints after it and reloads only on change. `CENTRAL_READ_POLICY` = 60 s lists / 300 s terminal Runs / 60 s walk; `STRICT_READ_POLICY` = 0. Run summaries (`indexed-runs.ts`) store the parsed README record without body plus `eligibilityError`, `sidecarFallback`, `contained`. It is memory-only and empty after every restart.
- All Experiment/Run writes go through `packages/core/src/experiments/mutations.ts` and `runs/mutations.ts` (a `MutationFs` port; results carry `FileChange[]`). A few core/CLI writers still write directly: `run record` (`writeFile … wx`), `discovery/deprecation.ts`, `experiments/rename.ts`.
- `discoverRuns(project)` honours `project.runDirs` (set from central `config.yml` by `config/load.ts`); absent = unbounded walk. `scanProjectRoot` / `resolveRunTarget` take an optional `runDirs`. The CLI has no project config: `project-scan/context.ts` builds an anonymous Project from `--project-root` / cwd without reading any file, so its only source is `--run-dir`. `.memon/version.json` is read/written by `fs-version/` (path resolved and checked inside the root, schema-validated, atomic temp + rename) — the model for the new `.memon/project.yml` reader.
- `.memon/` is not ignored as a whole in research projects: `version.json` and `wiki-review.csv` are tracked; `.memon/activity/` and `.memon/migrations/` are runtime state ignored per project or through `.git/info/exclude`.
- Projects live on NFSv3 mounts shared by central and CLI nodes: `O_EXCL` create and same-directory `rename` are atomic on the server; `O_APPEND` from several clients is not; attribute caching can delay stat changes by up to `acregmax`; `st_dev` differs per client mount.

## Goals / Non-Goals

**Goals:** cold read targets of D7 without weakening the external-edit guarantees (≤ 5 min on lists, detail documents always read); one index shared by central and CLI nodes; corruption or absence only costs reads; a mechanical migration.

**Non-Goals:** making the index authoritative; indexing Reports, code reviews, hypotheses or the Journal on disk (they stay in the in-process index); CLI read commands switching to the index (they keep strict validation and the bounded walk); wiki writers emitting events (wiki entries are validated within the list window); `storage:` changes; moving operator directories; git-status polling.

## Decisions

### 1. Layout

```
.memon/index/
  .gitignore            "*"  (ignores the directory itself and everything in it)
  snapshot.json         merged state, replaced only by rename
  compact.lock          lease of the current compactor (optional)
  events/
    <ts>-<pid>-<rand>.json      one write's upserts/removals
    .tmp-<ts>-<pid>-<rand>      in-flight event (ignored by readers)
```

- A self-ignoring `.gitignore` instead of relying on a `.memon/` rule (D2 assumed one; it does not exist because `.memon/` holds tracked files). It needs no edit of the project's own `.gitignore` and works for every project. Whoever creates the directory (writer, rebuild, migration) writes it first.
- The snapshot is named `snapshot.json`, not `runs.json` (the name in D2), because it also holds Experiment and wiki entries; it remains a single file as D2 decided.
- `<ts>` is the writer's epoch milliseconds zero-padded to 13 digits — an ordering key in a file name, not a timestamp field; every timestamp field inside the files is ISO8601 with the writer's offset. `<pid>` is the process id, `<rand>` 8 hex characters. No host name is written.

### 2. Formats (`index_version: 1`)

Fingerprint (persisted): `{ "ino": int, "size": int, "mtime_ms": number, "ctime_ms": number }` or `null` (absent). `dev` is left out of the persisted form because it differs between NFS client mounts; the in-process mirror keeps comparing the full local fingerprint once it has stat'ed a file itself.

Snapshot (draft JSON Schema, abbreviated):

```json
{
  "$id": "memon/derived-index/snapshot/v1",
  "type": "object",
  "required": ["index_version", "fs_convention_version", "generated_at", "generator", "run_dirs", "run_dirs_source", "walk", "merged_events", "runs", "experiments", "wiki"],
  "properties": {
    "index_version": { "const": 1 },
    "fs_convention_version": { "type": "integer", "minimum": 8 },
    "generated_at": { "type": "string", "format": "date-time" },
    "generator": { "type": "object", "required": ["release", "role"],
      "properties": { "release": { "type": "string" }, "role": { "enum": ["central", "cli", "rebuild", "migration"] } } },
    "run_dirs": { "type": "array", "items": { "type": "string" } },
    "run_dirs_source": { "enum": ["cli", "central", "project", "default"] },
    "walk": { "type": "object", "required": ["verified_at", "paths"],
      "properties": { "verified_at": { "type": "string" }, "paths": { "type": "array", "items": { "type": "string" } } } },
    "merged_events": { "type": "array", "items": { "type": "string" } },
    "runs": { "type": "object", "additionalProperties": { "$ref": "#/$defs/run" } },
    "experiments": { "type": "object", "additionalProperties": { "$ref": "#/$defs/experiment" } },
    "wiki": { "type": "object", "additionalProperties": { "$ref": "#/$defs/wiki" } }
  },
  "$defs": {
    "run": { "required": ["readme_fp", "dir_fp", "verified_at", "has_readme", "status", "archived", "archive_source", "deprecated", "eligibility_error", "contained", "owner", "row"],
      "properties": {
        "readme_fp": {}, "dir_fp": {}, "verified_at": { "type": "string" },
        "has_readme": { "type": "boolean" },
        "status": { "enum": ["PENDING", "RUNNING", "FINISHED", "INTERRUPTED", "FAILED", "UNKNOWN"] },
        "created_at": { "type": "string" }, "updated_at": { "type": "string" },
        "archived": { "type": "boolean" }, "archive_source": { "enum": ["frontmatter", "sidecar", "none"] },
        "deprecated": { "type": "boolean" }, "eligibility_error": { "type": ["string", "null"] },
        "contained": { "type": "boolean" },
        "owner": { "type": ["string", "null"] },
        "row": { "type": "object", "description": "exactly the Run list-row fields 7.4.0 renders (fixed by task 1.1)" },
        "parse_error_count": { "type": "integer" }, "parse_warning_codes": { "type": "array" } } },
    "experiment": { "required": ["dir", "id", "slug", "status", "archived", "runs", "readme_fp", "bundle_fp", "verified_at", "row"],
      "properties": {
        "dir": { "type": "string" }, "id": { "type": "string" }, "slug": { "type": "string" },
        "status": { "enum": ["OPEN", "RESOLVED", "ABANDONED"] }, "archived": { "type": "boolean" },
        "runs": { "type": "array", "items": { "type": "string" }, "description": "declared references, verbatim" },
        "readme_fp": {}, "bundle_fp": { "type": "object", "description": "implementation/investigation/results fingerprints" },
        "verified_at": { "type": "string" },
        "row": { "type": "object", "description": "the slim Experiment list-row fields of 7.4.0" } } },
    "wiki": { "required": ["id", "kind", "status", "sources", "fp", "verified_at"],
      "properties": { "id": {}, "kind": {}, "status": {}, "title": {}, "legacy_id": {}, "deprecated": {},
        "sources": { "type": "array" }, "fp": {}, "verified_at": {} } }
  }
}
```

Keys are project-relative POSIX paths (`logs/foo-260901-090000`, `docs/experiments/E0001-foo`, `docs/wiki/note/W0001-x.md`). No absolute path, host or user name is stored. `owner` is derived at merge time from Experiment entries (the unique declaring Experiment, else `null`); it is never written into a Run README.

Event:

```json
{
  "index_version": 1,
  "written_at": "2026-10-01T10:00:00+08:00",
  "writer": { "release": "8.0.0", "role": "cli", "op": "experiment.link" },
  "upserts": { "runs": { "<path>": { "...run entry" } }, "experiments": { "<dir>": { "...experiment entry" } } },
  "removals": { "runs": ["<path>"], "experiments": ["<dir>"] }
}
```

A reader that sees an `index_version` it does not know ignores that file (and never overwrites a snapshot with a higher version); a lower version is discarded and rebuilt. This is the evolution hook for v9.

### 3. Writer obligation and event write

- `MutationBase` gains an optional index sink (`projectRoot` + emitter). After a primitive's write succeeded, the sink derives entries from the primitive's own result (post-write content it already holds, plus one stat per changed file for the fingerprint) — no extra README parse beyond what the primitive did. The direct writers (`run record`, deprecate/undeprecate, Experiment rename, Run rename) are routed through the same sink. Backend/central adapters pass a sink too.
- Event write: `mkdir -p events` (and `.gitignore` if the directory is new) → open `.tmp-<name>` with `wx` → write → close → `rename` to `<name>`. Unique names make the rename non-clobbering; readers ignore dot files, so no reader sees a half-written event. Any failure is caught, returned as a `warnings[]` entry on the primitive's result (`INDEX_EVENT_FAILED`) and never changes the primary result or exit code.
- Writes do not read the FS marker (existing rule): a v8 writer on a v7 project emits events too; that only creates the ignored directory.
- Alternative rejected: shared JSONL append (non-atomic across NFS clients); per-writer lock on the snapshot (a crashed writer blocks every other writer; lock latency on NFS on every write).

### 4. Merge and compaction

Merge (used by readers, compaction and rebuild): start from the snapshot; apply events in file-name order; for each key an event entry replaces the current one unless the current entry's fingerprint has a newer `ctime_ms` (a later validation already saw a newer file); a removal applies unless the current entry was verified after the event's `written_at`. `owner` is recomputed after merging.

Compaction (central validator cycle, `memon index compact`, `memon index rebuild`):

1. Take the lease: create `compact.lock` with `wx`, content `{ "pid", "role", "expires_at" }` (120 s). If it exists and is unexpired → skip (central) or exit 9 `CONFLICT` (CLI). If expired → rename it to `.stale-<rand>` (only one contender's rename succeeds) and retry once.
2. List `events/`, read them, merge, write `.tmp-snapshot-<rand>` (`wx`), rename over `snapshot.json`. `merged_events` lists exactly the names merged.
3. Delete exactly those event files; remove `.tmp-*` older than one hour; release the lease.

Events created during compaction are not deleted (they were not listed). Deletion is by name, so clock skew between nodes cannot lose an event. If two compactors still overlap (lease expired mid-run), the worst case is a snapshot missing a deleted event's hint; the affected entry is corrected by fingerprint validation within its window, so the race costs freshness, never correctness beyond the window.

Triggers: central runs one validator cycle per active Project every 60 s (active = a request for that Project within the last 10 minutes) and compacts at the end of a cycle when it merged events or changed entries. CLI: `memon index compact` (merge only, no README reads), `memon index rebuild`. Readers never compact.

### 5. Validation and staleness

- Every entry carries `verified_at`. When central seeds `ProjectReadIndex` from the merged snapshot, each entry's `validatedAt` is its `verified_at`, so the existing windows apply unchanged: lists reuse an entry verified within 60 s (300 s for terminal Runs) without I/O.
- The central validator keeps entries fresh in the background, inside the 7.4.0 windows: each cycle stats every non-terminal Run, Experiment README/bundle and wiki page, and a rotating fifth of terminal Runs (so each is stat'ed at least every 300 s), and re-runs the bounded walk. A changed fingerprint reloads that entry (one README read) and is written back by the next compaction. Estimated budget on the measured project: ≈ 350 stats + ≈ 5 listings per minute while active, nothing while idle.
- After an idle period or a restart, list pages render immediately from the snapshot (stale-while-revalidate) and the first cycle starts at once; the 5-minute bound therefore holds while the Project is active and is exceeded at most by one cycle after idleness. This is what lets list pages render without a walk after restart.
- Detail pages keep reading the requested documents (Experiment README and YAML, the requested Run README, wiki page) on every request. **Changed (Q1, accepted):** an Experiment detail's member facts (status, archived, deprecated, eligibility errors of its declared Runs) are list-class data served within the list windows; 7.4.0 stat'ed every member on every detail request, which alone is 448 calls and makes the ≤ 100 target impossible. A Run's own detail still validates it.
- Freshness by page and datum (central, Project active):

| Page | Datum | Freshness |
|---|---|---|
| Experiment list | Experiment rows | entry within 60 s; background cycle every 60 s |
| Run list / anomalies | Run status, archived, deprecated, owner | 60 s non-terminal, 300 s terminal; new Run dirs ≤ 60 s (walk) |
| Wiki list | page inventory, staleness | 60 s |
| Experiment detail | README, `implementation.yaml`, `investigation.yaml`, `results.yaml` | read on every request |
| Experiment detail | member status / archived / deprecated / eligibility | list window (60 s / 300 s), **not** per-request stat |
| Experiment detail, explicit refresh | members | every member fingerprint re-taken for that request (≈ one stat per member, user-initiated only) |
| any page after a central write to the Experiment or its Runs | affected entries | immediate (in-process invalidation) |
| any page after a CLI-node write | affected entries | next validator cycle (≤ 60 s) via its event, or the entry's own window |
| Run detail | the Run README | read on every request |

  The explicit refresh is the existing manual refresh of `file-operation-scheduler`; ordinary navigation, focus and heartbeats do not count as one.
- Containment: an entry records `contained` once its path was verified with real paths; the verdict is kept while the fingerprint matches (a swapped symlink changes the fingerprint and forces re-resolution) and nothing is read through an unverified path. The Project root real path is resolved once per process cycle as before.
- CLI readers are unchanged (strict, bounded walk). `memon index status --verify` is the CLI's view of drift.

### 6. Read path

`ProjectReadIndex` becomes the in-memory mirror of the snapshot: on first use per Project it reads `snapshot.json` (1 read), lists `events/` (1 listing), reads unmerged events and seeds `run:`, Experiment, wiki and walk entries. Consumers (Experiment list/detail, Run list/anomalies, wiki inventory/list/staleness) are unchanged; they get warm entries. Entries the snapshot does not cover (Reports, code reviews, hypotheses, Journal, directory listings) keep the 7.4.0 on-demand behaviour. If the snapshot is missing, unreadable, invalid or of an unknown version, the mirror starts empty (exactly 7.4.0 behaviour) and central schedules a rebuild in the background; no page fails. Every successful central mutation keeps invalidating the in-process index (7.4.0) and now also emits an event.

Expected cold cost (estimate, harness-verified in tasks): 448-member detail ≈ 40–60 calls (snapshot, events, root real path, the Experiment's four documents, layout listings); wiki list ≈ 60–150; anomalies ≈ 20–60.

### 7. Rebuild and drift

`memon index rebuild` (and the migration): take the lease, run the bounded walk with the effective `run_dirs`, read every Run README once, every Experiment README plus stats of its YAML files, every wiki page, write a fresh snapshot (`generator.role = rebuild`), delete all events present at the start. `--audit-run-dirs` additionally performs one unbounded walk under `logs/`, `outputs/`, `experiments/` and reports Run directories outside the effective patterns (read-only report, used by the migration). `memon index status --verify` stats every entry, re-walks and compares, reporting `INDEX_DRIFT` records `{ kind, key, field, indexed, disk }`; `--strict` exits 1 on drift.

### 8. Relation to the 7.4.0 in-process index

Same entry model, fingerprints and windows; the in-process index is the authority for in-flight requests and the snapshot is its persisted image plus other writers' events. The ETag/304 dependency recording keeps working because seeded entries carry fingerprints. The memory-only, never-persisted wording of `project-read-performance`/`runtime-cache` is replaced (specs).

### 9. Default `run_dirs` (compatibility)

- v8 default `["logs/*", "outputs/*", "experiments/*"]` = three listings plus nothing deeper. Projects that keep Runs deeper (`outputs/<group>/<run>`) lose those Runs from walks — Run list, base-name resolution, anomalies' walk side — unless they declare `run_dirs` (preferably `.memon/project.yml`, §11; or central project config / CLI `--run-dir`).
- Not lost: declared Experiment members (resolved by path, never by the walk), path-qualified references, and Run detail by path.
- Surfacing: the migration's `--audit-run-dirs` report lists them before the marker moves (Detection/Edge Cases of the guide); `RUN_OUTSIDE_RUN_DIRS` (lint level) is reported for declared Experiment paths that the effective patterns do not match, by `memon experiment doc lint` and in `memon index status --verify`.
- Nesting: `RUN_NESTED` (lint error) for a declared path with a Run-shaped ancestor segment; `memon run lint` lists Run-shaped direct children of the Run; `run record` refuses to create a Run inside a Run. The walk already never descends into Runs.

### 10. Migration v7 → v8 (mechanical)

Plan (read-only): check marker 7 and a clean tree; run `memon index rebuild --audit-run-dirs --dry-run` to report outside-pattern Runs. Apply: `memon index rebuild` (creates `.memon/index/` with its `.gitignore`), verify (`memon index status --verify --strict`, `git check-ignore .memon/index/snapshot.json`), then advance the marker to 8 and commit only `.memon/version.json` with `chore(memon): migrate FS convention v7 -> v8`. Rollback: `git revert` of that commit (marker back to 7) and optionally `rm -rf .memon/index`. `scripts/migrate-v7-to-v8.{mjs,md}` wrap plan/apply/verify/rollback with the v6→v7 shape (report counts, never print private content). No user document is read for rewriting, so no preimage backup is needed beyond the marker. The migration never creates `.memon/project.yml` (Q2): plan/apply use an existing declaration, and the plan's deep-Run warnings and the guide's Edge Cases recommend creating it by hand after the migration (`memon project init`, edit `run_dirs`, commit separately, `memon index rebuild`).

### 11. Project declaration `.memon/project.yml` (Q2)

Problem: central knows `run_dirs` from its own `config.yml`, a CLI node only from per-invocation `--run-dir`; a project with deep Runs would need every node and skill to repeat the flag, and central and CLI walks would silently disagree. A tracked file in the project gives both the same rule.

Schema (`schema_version: 1`, YAML mapping, strict):

```yaml
schema_version: 1          # required, integer, only 1 is supported
run_dirs:                  # optional, non-empty; same pattern rules as central run_dirs
  - logs/*
  - outputs/*/*
```

Any other key → `PROJECT_DECLARATION_INVALID` (forward extension happens by bumping `schema_version` or adding keys in a later change, never by tolerating unknown keys now).

Precedence (first present source wins as a whole, never merged):

| # | Source | Seen by |
|---|---|---|
| 1 | CLI `--run-dir` | CLI |
| 2 | central Project `run_dirs` (`config.yml`) | central |
| 3 | `.memon/project.yml` `run_dirs` | CLI, central, core callers |
| 4 | v8 default `["logs/*", "outputs/*", "experiments/*"]` | all |

Central config stays above the project file so an operator can override a project locally (for example to narrow a huge tree) without a commit; a CLI flag stays above everything because it is an explicit one-off.

Reading points: `core/src/project-declaration/` (new) with `resolveProjectDeclarationPath` (inside-root check as in `fs-version/paths.ts`), `loadProjectDeclaration(root)` (null when absent, zod-validated otherwise) and `resolveEffectiveRunDirs({ cliRunDirs?, projectRunDirs?, root })` → `{ patterns, source }`. `scanProjectRoot`, `discoverRuns` and `resolveRunTarget` call it when no explicit `runDirs` is passed; the CLI passes `--run-dir` only when given; central passes `project.runDirs` only when configured. On central the file is an observed file in the Store (same 60 s window as the walk), so editing it changes walks within a minute. An invalid file fails closed (CLI exit 2, central marks the Project's walk-dependent reads as failed with that diagnostic) rather than silently using the default, because a wrong default would hide Runs.

Writing: no automatic writer. `memon project init` (exclusive create; default content, or the global `--run-dir` patterns; `CONFLICT` if present; never commits) and hand edits. `memon project lint` validates and prints the effective patterns with their source; `memon index status` shows recorded vs effective `run_dirs`. The derived index records `run_dirs_source`; a reader re-walks when the recorded patterns differ from its effective ones, and verify reports that as `INDEX_DRIFT` (`walk` / `run_dirs`). Skills never write the file.

Repository impact: the file is tracked, so creating it is a one-time, optional new file in the user's repository, committed by the user (not part of the migration commit).

### 12. Acceptance on the operator project (Q3)

The cold targets (D7) are only meaningful against the measured project's real index, so acceptance builds it there — as part of that project's v8 migration and at no other time:

1. Preconditions: release 8.0.0 built locally; the project's working tree clean; operator approval for the migration step.
2. Back up the whole `.memon/` directory (copy outside the project, recorded only in the machine-local notes) before any write.
3. Run the guide's plan; acknowledge the deep-Run report.
4. Apply: `memon index rebuild` (writes only `.memon/index/`), `memon index status --verify --strict`, `git check-ignore`, then marker 7 → 8 and the migration commit.
5. Run the harness (cold/warm/heartbeat, background validator disabled) and one validator cycle/compaction measurement.

Rollback: any failure in steps 4–5 before the marker moves → restore `.memon/` from the backup (removes `.memon/index/`, marker stays 7), no commit. Failure after the marker commit → `git revert` the migration commit and restore `.memon/` from the backup. Missing a target is not a rollback trigger by itself (the index is only a cache); it is reported and blocks the release claim. No real project name or path is written into tracked files.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| NFS attribute cache hides a README change for up to `acregmax` | Adds to the list window only; details read documents; documented, as in 7.4.0. |
| Persisted fingerprint without `dev` matches a different file with the same inode number | Paths are keys and the size+mtime+ctime must also match; a false match needs inode reuse with identical times; next modification corrects it. |
| Two writers create events concurrently | Unique names + `wx` + rename; no shared file is modified. |
| Two compactors overlap (expired lease) | Deletion by explicit name list; a lost hint is corrected by validation within the window. |
| Crashed writer leaves `.tmp-*` | Ignored by readers, removed by compaction after one hour. |
| Events accumulate when central is down | Readers read them all (cost grows with backlog); `memon index status` reports count/age; `memon index compact` drains them. |
| Snapshot corrupt, truncated or unknown version | Mirror starts empty (7.4.0 behaviour) and rebuild is scheduled; never a page error; unknown higher version is never overwritten. |
| v7 tools keep writing without events | Their edits are external edits: caught by validation; v7 skills stop on `ahead`. |
| Default `run_dirs` hides deep undeclared Runs | Audit before migration, lint, explicit `run_dirs`; declared members unaffected. |
| Experiment detail member status up to 60 s / 300 s stale | Accepted (Q1); explicit refresh and central writes re-validate; the Run's own detail is always fresh. |
| Central and CLI disagree on Run locations | `.memon/project.yml` gives both the same rule; the snapshot records the source and verify reports a mismatch. |
| Invalid `.memon/project.yml` hides Runs | Fails closed with a named error, never a silent default; `memon project lint`. |
| Acceptance writes on the operator project | Only during its migration step, `.memon/` backed up first, rollback defined (§12). |
| Background validator cost on shared clusters | Only while a Project is active; bounded per cycle; measured in tasks. |
| Snapshot read size (≈ 0.5 MB for 1,300 Runs) | One read per process per snapshot change; replaces thousands of calls. |

## Migration Plan

Archive `bounded-run-discovery` and `central-read-path-trimming` first. Ship core/CLI/backend/web/skills together as release 8.0.0 (`MEMON_CHANGED_SURFACES=central,cli,skills,filesystem`). Every CLI node runs `memon update` before its projects are migrated; central is redeployed; each project is migrated with the guide; projects with deep Runs then add `.memon/project.yml` themselves. Rollback: previous 7.4.x release plus the guide's marker revert; the index directory may simply be deleted.

## Open Questions

- Exact list-row field set persisted for Runs (`row`), fixed by the consumer audit in task 1.1 — it may only shrink the schema, not change the approach.
- Whether central should expose `INDEX_DRIFT` counts next to anomalies later (not required by this change).
