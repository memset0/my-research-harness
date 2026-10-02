## 0. Preconditions

- [ ] 0.1 Confirm `run-results-v9` is archived (FS v9, `result.csv`, the summary's `INTERRUPTED` → `RUNNING` derivation and `index_version: 2` exist in the canonical specs); verify `openspec validate run-record-and-resume --type change --strict` and `openspec validate --all --strict` pass and every MODIFIED block still carries all canonical scenarios.

## 1. Core: Run record contract

- [ ] 1.1 Extend `RunFrontMatter`, `RunFrontMatterRawSchema`, the parser and the key-preserving serializer with `stop_reason`, `stop_evidence`, `target_steps`, `resources`, `schedule` (priority, preemptible, audit), `resumable`, `wandb_run_id`, `checkpoint`, `progress` and `launches`; verify with parser/serializer tests: old READMEs parse with defaults and no warnings, unknown keys and body stay byte-identical, round-trip of the design §1 example.
- [ ] 1.2 Add Run lint for the launch history (`RUN_LAUNCH_HISTORY_INVALID`) and stop reasons; update `setRunStatus` so `INTERRUPTED` sets `stop_reason` (default `unknown`) and `stop_evidence` (null when none is given) and clears `finished_at`, other statuses clear both, idempotency includes reason and evidence and launches are never touched; verify with mutation tests for every `run-edit` scenario, including a reclassified `FAILED` Run whose launch history stays byte-identical.
- [ ] 1.3 Move the derived index to `index_version: 3` (Run row additions, acceptance and compaction of v2 events) and make `INTERRUPTED` non-terminal in central's validation windows; verify with schema/merge/compaction tests and a backend window test.

## 2. Core: launch engine

- [ ] 2.1 Implement Run creation (`createRun`: exclusive directory at an effective Run location, PENDING record with intent and attributes, `--resumable` evidence check, `--preemptible` reason check, `--wandb-id auto`) and the `RESULT_FILE_IGNORED` check of `run create` and `run record` through the shared core function of `run-results-v9`; verify with tests for each `run-launch` creation scenario, the `BAD_REQUEST` refusals, and a temporary Git repository whose `.gitignore` ignores Run files (warning with the fix command, `.gitignore` byte-unchanged, no check outside Git).
- [ ] 2.2 Implement the supervisor: preconditions and launch lock, record update before start, `launch-<n>.json`, `.memon/.gitignore`, env contract, process-group spawn, log append with separator/end lines, heartbeat timer, stop-file polling, signal forwarding with grace, stage target, exit classification, record finalization with lock retry and outcome-file fallback, `result.csv` version-row creation for member Runs with the `RESULT_FILE_IGNORED` warning before detaching when the file is ignored; verify with integration tests using small fake entry scripts (exit 0, exit 1, SIGKILL, SIGTERM with checkpoint, stage target, silent script, progress-writing script) on a temp project.
- [ ] 2.3 Implement detach (own session, return after RUNNING is recorded, survives the parent) and the single-receipt hand-over; verify with a test that kills the parent process and observes the heartbeat still advancing and exactly one receipt.
- [ ] 2.4 Implement resume (`resumable` check, `--allow-failed`, start step from the latest checkpoint or 0, `MEMON_RESUME`, W&B env, `RESUME_DID_NOT_RESTORE`) and restart (`--restart` from step 0), with `FAILED` refusals (resume without `--allow-failed`, launch without `--restart`) that name a new Run as the default retry, the missing flag and the evidence-backed reclassification; verify with tests for each resume scenario including "resume before the first checkpoint" and "failed Run is not continued implicitly".
- [ ] 2.5 Implement stop requests (same-host signal + cross-host file) and reconcile (stale by observation, same-host liveness check, `--assume-lost` after 10 min, lock cleanup); verify with tests using a fake clock and a vanished wrapper.

## 3. CLI

- [ ] 3.1 Register `memon run create|launch|resume|stop|reconcile|progress`, extend `run record` and `run status set` (`--stop-reason`, `--evidence`: rejected for targets other than `INTERRUPTED`, required when the current status is `FAILED`), update help; verify with CLI tests for every `memon-cli` scenario, exit codes 1/2/9, JSON outputs, and receipts (`progress` writes none).

## 4. Backend and Web

- [ ] 4.1 Expose the new Run fields in Run detail/list responses and add the `GET /api/runs/:id/live` progress/heartbeat resource (path containment, route-table entry, 5 s validation window, `ETag`/`304`, read only for `RUNNING` Runs); verify with backend route tests and a test that a list of finished Runs reads no live file.
- [ ] 4.2 Add the Run panel launch table, stop-reason badge wrapper (tooltip with the recorded stop evidence), live progress bar and heartbeat state with polling through the common resource lifecycle (query keys from `lib/query-keys.ts`); verify with component tests and the query-key snapshot test.
- [ ] 4.3 F1 verification on a release-build preview: loopback port 3742, temporary standalone config, scratch copy of `mock/project-a` containing a Run launched through the wrapper with a fake progress-writing script (never the live host or its `.next`); run AGENTS.md §4.3 steps 1–5 (typecheck, `/` 200, grep the Run panel markup for the launch table and progress markers, grep the referenced stylesheets for the five oklch tokens, desktop and 390 px screenshots); stop the preview by process group and delete the scratch copy.

## 5. Skills

- [ ] 5.1 Update `memon-write-script` (wrapper-aware template, SIGTERM checkpoint, launch-numbered files, no memon calls), `memon-run-experiment` (create/launch/progress/resume/stop flow; FAILED-retry rule — a new Run by default, `--allow-failed` or `--restart` in place only on the user's explicit request; the evidence procedure for interruptions misrecorded as `FAILED` — last launch exit code and signal, node-reclamation signs, a scheduler's recorded stop reason, the `run.log` tail — with reclassification through `--evidence` before resuming and asking the user when unsure; `RESULT_FILE_IGNORED` relayed to the user; preemptible/resumable wording verbatim from the spec) and the shared reference (progress file helper); verify the skills build and tests and a grep that every `--preemptible` example carries `--preemptible-reason` and the "only when the user explicitly asks" sentence, and that the FAILED procedure names all four kinds of evidence and the ask-the-user rule.

## 6. Release metadata and verification

- [ ] 6.1 Update `AGENTS.md` §2.1 (Run record contract, `<runDir>/.memon/`, launch files) and README Run documentation; verify no operator-specific names appear (grep against `LOCAL.md` names).
- [ ] 6.2 Run the change-relevant test list (core readme/runs/launch/derived-index; backend runs routes and windows; CLI run commands; web Run panel; skills) and `pnpm typecheck`; verify all pass and report the list and results.
