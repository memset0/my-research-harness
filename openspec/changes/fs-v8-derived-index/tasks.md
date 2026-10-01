## 0. Preconditions

- [ ] 0.1 Confirm `bounded-run-discovery` and `central-read-path-trimming` are archived (their requirements exist in `openspec/specs/run-discovery`, `project-read-performance`, `runtime-cache`, `memon-cli`) and re-run `openspec validate fs-v8-derived-index --type change --strict`; verify it passes against the synced canonical specs.

## 1. Core index model and event writes

- [ ] 1.1 Audit the consumers of `RunSummary` and the slim Experiment row in `packages/backend` (Run list row, anomalies, wiki staleness, Experiment detail eligibility, Experiment list) and fix the persisted Run `row` / Experiment `row` field sets in design.md §2; verify by listing each consumer field against the schema in the design (no field without a consumer).
- [ ] 1.2 Add `packages/core/src/derived-index/` with the zod schemas for snapshot, event and entries (`index_version: 1`), persisted fingerprint (ino/size/mtime/ctime, no dev), path helpers for `.memon/index/` and the `.gitignore` (`*`) bootstrap; verify with unit tests for schema round-trip, rejection of unknown/higher versions, rejection of absolute paths, and that the bootstrap writes `.gitignore` before any other file.
- [ ] 1.3 Implement entry derivation from the data each write primitive already holds (Run summary from README content + stat; Experiment entry from README + YAML stats; owner recomputation) sharing the parsing rules of `packages/backend/src/indexed-runs.ts` (move the shared parts into core); verify that a derived entry equals the 7.4.0 in-memory `RunSummary` projection for the mock project's Runs.
- [ ] 1.4 Implement event publishing (temp file with `wx`, complete write, rename to `<ts>-<pid>-<rand>.json`, failures returned as `INDEX_EVENT_FAILED` warnings) and an optional index sink on `MutationBase`; verify with tests: concurrent publishers produce distinct complete files, a read-only `events/` yields a warning and an unchanged primary result, readers skip dot files.
- [ ] 1.5 Wire the sink into every primitive in `experiments/mutations.ts` and `runs/mutations.ts`, and route `run record`, deprecate/undeprecate (`discovery/deprecation.ts`), Experiment rename and Run rename through it; verify with `mutation-parity` tests that every write op emits exactly one event with the expected upserts/removals and that the written project bytes are unchanged from 7.4.0.

## 2. Merge, compaction and rebuild

- [ ] 2.1 Implement the merge (snapshot + events in name order, ctime/verified_at precedence rules, owner recomputation); verify with table tests covering stale event vs newer validation, removal vs later verification, and idempotent re-merge.
- [ ] 2.2 Implement the lease (`compact.lock` `wx`, 120 s expiry, takeover by rename) and compaction (temp snapshot `wx` + rename, `merged_events`, delete-by-name, `.tmp-*` cleanup after one hour, refuse to overwrite a higher `index_version`); verify with tests: event created mid-compaction survives, held lease → `CONFLICT`, expired lease is taken over by exactly one contender.
- [ ] 2.3 Implement full rebuild (bounded walk with effective `run_dirs`, README/YAML/wiki reads, events deletion) and verification (`INDEX_DRIFT` records, `RUN_OUTSIDE_RUN_DIRS` notices) plus the read-only `--audit-run-dirs` unbounded walk; verify on a fixture with deep Runs, external README edits and a nested declared path that rebuild → verify reports no drift and the audit lists exactly the deep Runs.
- [ ] 2.4 Implement damaged-index handling (missing/truncated/invalid snapshot → empty view; unparsable events older than 60 s skipped and reported); verify with corrupted-file fixtures.

## 3. Read side (backend / central web)

- [ ] 3.1 Seed `ProjectReadIndex` from the merged derived index on first use per Project (Run, Experiment, wiki and walk entries with `validatedAt = verified_at`; containment verdicts tied to fingerprints) and fall back to the 7.4.0 on-demand path when the index is unusable; verify with `read-index`/`summary-index` tests that a seeded process serves the Experiment list, Run list and wiki list without any README read or walk on the mock project.
- [ ] 3.2 Move Experiment-detail member eligibility to the list windows while still reading the Experiment's own documents on every request; verify with a test that a 448-member fixture detail performs zero member stats when entries are within the window and re-validates them after the window.
- [ ] 3.3 Add the central background validator per active Project (60 s cycle while a request arrived in the last 10 minutes: non-terminal Runs, Experiments, wiki and walk every cycle, terminal Runs in a five-way rotation) that writes changes back through compaction and pass an index sink to every backend mutation; verify with fake-clock tests that an external status edit reaches the list within 60 s (non-terminal) / 300 s (terminal), that idle Projects cause no I/O, and that central writes emit events.
- [ ] 3.4 Verify anomalies computed from seeded entries equal file-based anomalies on the mock projects (test), that `PHANTOM_RUN_REF` still follows the declared path, and that index drift never appears on the anomaly stream.
- [ ] 3.5 Run the cherry-picked backend/web tests touching read-index, summary-index, indexed-documents, conditional-read, project-service, wiki-service and the anomaly routes; verify they pass and ETag/304 heartbeats still answer `304` for unchanged lists.

## 4. CLI commands

- [ ] 4.1 Add `memon index status [--verify] [--strict]`, `memon index compact`, `memon index rebuild [--audit-run-dirs] [--dry-run]` with `--project-root`, `--format`, global `--run-dir`, exit codes 0/1/2/9 and no journal receipt; verify with CLI tests for each scenario in the `memon-cli` delta (missing index, drift with `--strict`, held lease, idempotent rebuild, dry-run writes nothing).
- [ ] 4.2 Surface `INDEX_EVENT_FAILED` warnings in every CLI write command's JSON/human output without changing exit codes; verify with a test using an unwritable `events/` directory.
- [ ] 4.3 Update `memon --help` / command help text for `index` and the default Run locations; verify the help snapshot test.

## 5. Default `run_dirs` and layout lint

- [ ] 5.1 Make the effective `run_dirs` default to `["logs/*", "outputs/*", "experiments/*"]` for configured Projects, bare-root scans and the CLI when nothing is declared; keep the unbounded walk only for the audit; verify with discovery tests (default scenario, declared patterns, listing counts) and update fixtures that relied on unbounded depth.
- [ ] 5.2 Add `RUN_NESTED` (declared path with a Run-shaped ancestor in Experiment document lint; Run-shaped direct children in `memon run lint`; refusal in `run record`) and `RUN_OUTSIDE_RUN_DIRS` (declared path not matched by the effective patterns); verify with lint tests and a `run record` refusal test (exit 2).
- [ ] 5.3 Update bundled skills (`memon-write-script`, `memon-run-experiment`, `memon-migrate-fs`, shared guidance) per the `memon-skills` delta — no index editing, Run directories only at effective locations and never nested, v7→v8 step — and run the skills build/tests; verify `component-docs.mjs --check` and the skills test suite pass and no skill mentions editing `.memon/index/`.

## 6. Migration guide and version gate

- [ ] 6.1 Write `packages/core/migrations/v7-to-v8.md` following `fs-migration-guide-authoring` (seven H2 sections in order, literal Detection commands, Diff for `.memon/version.json` and the added `.memon/index/`, fail-closed Verification including `memon index status --verify --strict` and `git check-ignore`, Rollback Notes with `chore(memon): migrate FS convention v7 -> v8`, the four canonical edge cases plus deep Runs, nested Runs and pending v7 CLI nodes); verify with a guide test modelled on `v6-to-v7-guide.test.ts`.
- [ ] 6.2 Add `scripts/migrate-v7-to-v8.mjs` and `scripts/migrate-v7-to-v8.md` (plan/apply/verify/rollback; plan read-only with the run-dirs audit; apply commits only the marker; reports counts, never document content); verify on a scratch copy of `mock/project-a` with an added deep Run: plan lists it, apply leaves every document byte-identical, verify passes, rollback restores marker 7.
- [ ] 6.3 Set `FS_CONVENTION_VERSION = 8` and `MEMON_RELEASE = '8.0.0'` together with release-policy/validate-release expectations for the v7→v8 guide, and update tests that assert the previous values; verify `version.test.ts`, `release-policy.test.ts`, `release-compatibility.test.ts`, `fs-version` tests and `MEMON_CHANGED_SURFACES=central,cli,skills,filesystem MEMON_PREVIOUS_FS_CONVENTION=7 node scripts/validate-release.mjs` pass.
- [ ] 6.4 Verify `memon fs-version check` reports `behind` for marker 7 and exits 11 for marker 9, and that `memon install-skills` on a fresh root writes marker 8; verify with the fs-version-check and install-skills tests.
- [ ] 6.5 Update `AGENTS.md` §2.1 file model skeleton and §2 scripts list for the derived index, default Run locations and `migrate-v7-to-v8.*`; verify the text contains no operator-specific names (grep against the names in `LOCAL.md`).

## 7. Acceptance with the I/O harness

- [ ] 7.1 Record the location and invocation of the read-only offline I/O harness used for the 7.4.0 measurements (operator-local, not tracked) in `LOCAL.md`; verify the harness runs against this build with the background validator disabled.
- [ ] 7.2 With explicit operator approval, build the derived index of the measured project (or of a faithful read-only copy) — the only write is `.memon/index/` — and run the harness cold/warm/heartbeat for the 7.4.0 page set; verify: 448-member Experiment detail cold ≤ 100 calls, wiki list cold ≤ 200, anomalies cold ≤ 200, list pages render after restart without a Run walk, warm/heartbeat not above 7.4.0.
- [ ] 7.3 Measure one background validator cycle and one compaction on the same project and an external-edit visibility test (rewrite a copy's Run status outside memon, observe the list within 60 s / 300 s); verify the numbers and record them, anonymised, in design.md "Measurements".
- [ ] 7.4 Run the change-relevant test list (core derived-index, mutations parity, discovery, lint, fs-version, migration guide; backend read-index/summary-index/project-service/wiki-service/anomalies; CLI index/scan/run-record; skills) and `pnpm typecheck`; verify all pass and report the list and results.
