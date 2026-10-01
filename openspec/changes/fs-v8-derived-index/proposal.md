## Why

Release 7.4.0 made warm central reads cheap with an in-process summary index, but that index lives only in one process: every restart, and every Experiment detail, wiki list or anomaly computation that runs before the index is warm, pays again for a Run walk plus one stat/read/realpath set per Run. On the measured network-mounted project (about 1,300 Runs, a 448-member Experiment, 36 wiki pages) a cold Experiment detail costs 2,877 fs calls, a cold wiki list 7,813 and cold anomalies 4,806, and a CLI node never benefits at all. Run READMEs are also edited outside memon (launch scripts write `RUNNING` and later rewrite the status with a regex, `git pull` rewrites tracked READMEs), so whatever replaces the walk must stay a validated cache, never a second source of truth. FS v8 makes a persisted, writer-maintained, rebuildable per-project index part of the on-disk convention, and bounds the default Run locations so rebuilding it is cheap.

## What Changes

- **D1 – derived, rebuildable index.** A per-project index under `.memon/index/` holds summaries of Runs, Experiments and wiki pages, each with the file fingerprint it was built from. It is a cache: deleting it changes no response, every entry is validated against the file before it outlives its staleness window, and `memon index rebuild` recreates it from the files alone.
- **D2 – multi-writer safe layout.** Writers never append to a shared file (NFSv3 appends are not atomic across clients): each write exclusively creates one event file `.memon/index/events/<ts>-<pid>-<rand>.json`. Central (periodically) or `memon index compact` merges events into one snapshot file replaced by rename, then deletes exactly the merged events. Readers read the snapshot plus unmerged events. The index directory carries its own `.gitignore` (`*`) because `.memon/` itself holds tracked files (`version.json`, `wiki-review.csv`).
- **D3 – index content limited to what 7.4.0 reads.** Run: project-relative path, derived owning Experiment, status, `updated_at`, `deprecated`, `archived`, README fingerprint, plus the fields the current Run list row renders. Experiment: id, slug, status, archived, declared Run paths, the slim list-row fields, README and bundle fingerprints. Wiki: id, kind, status, sources and the inventory fields, fingerprint.
- **D4 – writer obligation.** Every successful core Experiment/Run write (the `experiments/mutations` and `runs/mutations` primitives and the remaining core Run/Experiment writers routed through the same sink: record, deprecate, rename) emits an event; event failure never fails the primary write (it is reported as a warning). External edits are covered by fingerprint validation, `memon index rebuild` and `memon index status --verify`, which reports index/disk drift.
- **D5 – v8 conventions.** **BREAKING:** a Project without `run_dirs` uses the default `["logs/*", "outputs/*", "experiments/*"]` instead of the unbounded walk. Run directories do not nest (convention plus lint). The index directory, snapshot and event formats carry an `index_version` field.
- **D6 – version gate.** **BREAKING:** `FS_CONVENTION_VERSION = 8`, `MEMON_RELEASE = '8.0.0'`; the marker moves 7→8 through a mechanical migration (create the index and run the first rebuild; no user document changes) described by `packages/core/migrations/v7-to-v8.md` in the seven-section format with commit `chore(memon): migrate FS convention v7 -> v8`, and an operator entry `scripts/migrate-v7-to-v8.*`. Skill preflight reports `behind` for marker 7.
- **D7 – read targets (acceptance).** Cold, measured with the existing read-only offline I/O harness: 448-member Experiment detail ≤ 100 fs calls (7.4.0: cold 2,877 / warm 494), wiki list ≤ 200 (7.4.0 cold 7,813), anomalies ≤ 200 (7.4.0 cold 4,806); list pages render after a restart without a Run walk. Lists may be up to 5 minutes stale for external edits; detail pages always read the requested documents themselves.
- New CLI group `memon index rebuild|compact|status`.
- **D8 – not changed:** Run README layout, the three Experiment YAML files, `storage:` semantics, and the location of any directory in an operator project.

## Capabilities

### New Capabilities
- `derived-index`: the on-disk derived index convention — layout, snapshot/event formats and versions, writer obligation, merge/compaction and lease, validation and staleness, corruption fallback, rebuild and drift reporting.

### Modified Capabilities
- `fs-version-tracking`: the convention value becomes 8 with release 8.0.0 and the v7 marker is `behind`.
- `run-discovery`: an absent `run_dirs` means the v8 default patterns instead of the unbounded walk; Runs outside the effective patterns are reported by lint; Run nesting becomes a linted convention.
- `project-read-performance`: the central summary index is seeded from and persisted to the derived index, list pages render without a walk after restart, and Experiment-detail member eligibility uses the list window; cold read targets.
- `runtime-cache`: the retained parsed data may be seeded from the persisted derived index.
- `memon-cli`: `memon index rebuild|compact|status`; CLI writes emit index events without needing central.
- `memon-skills`: skills never edit the index by hand; preflight is unchanged and needs no index step; skills that edit Run READMEs directly do not need to maintain the index.
- `fs-migration-runtime`: the reviewed mechanical v7→v8 migration and its version gate.
- `experiment-membership-anomalies`: anomalies computed from the index equal those computed from disk within the window; index drift is lint, not a membership anomaly.

## Impact

- **filesystem (MAJOR)**: new `.memon/index/` convention, default Run locations, marker 8. Release 8.0.0; `MEMON_CHANGED_SURFACES=central,cli,skills,filesystem`.
- **core**: index model/schema, event sink in the write primitives, merge/compaction/rebuild, default `run_dirs`, nesting and outside-pattern lint, version constants, v7→v8 guide.
- **cli**: `memon index …`; existing write commands emit events through core; `run record` routed through the shared sink.
- **backend / web (central)**: `ProjectReadIndex` becomes the in-memory mirror of the snapshot (seeded at first use, written back by a background validator/compactor), read paths use it instead of walking.
- **skills**: preflight wording unchanged; guidance that the index is never edited; `memon-migrate-fs` covers v7→v8.
- **operators**: every CLI node must `memon update` before its project is migrated (v7 skills on a v8 project stop with `MEMON_TOO_OLD`); projects with Runs deeper than the default patterns must declare `run_dirs` (central config / `--run-dir`) or accept that undeclared deep Runs leave walks (declared members still resolve by path).
- **Ordering**: applies after the completed changes `bounded-run-discovery` and `central-read-path-trimming` are archived; several MODIFIED requirements here are the ones those changes add.
- **Rollback**: deleting `.memon/index/` is always safe; reverting to 7.x tooling requires restoring marker 7 as described in the guide's Rollback Notes (git revert of the migration commit).
