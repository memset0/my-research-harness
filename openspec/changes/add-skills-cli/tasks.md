## 1. Core helpers (`@memon/core`)

- [x] 1.1 Add `loadCliContext({ projectRoot?, configPath?, cwd })` that returns `{ projects, configSource }` honoring the precedence: `--project-root` > `--config` > cwd `config.yml` > implicit cwd. Mutual exclusion check throws a tagged `CliContextError` with a `BAD_REQUEST` code.
- [x] 1.2 Add `scanProjectRoot(absRoot, { includeArchived? })` returning the full snapshot shape (`{ projectRoot, scannedAt, experiments, hypotheses, journal }`). Internally uses `discoverExperiments` + `readExperimentDir` + `parseHypotheses` + `parseJournal`. Bails with `NOT_FOUND` if the root path doesn't exist or isn't a directory.
- [x] 1.3 Confirm `appendJournalEvent` rejects `STATUS` tag at the helper layer (defense in depth) — currently any tag is accepted; add a guard so callers can't bypass via a typo.
- [x] 1.4 Confirm `updateLastDigestAt` is exported and stable (it already exists per the journal spec); no code change unless needed.
- [x] 1.5 Extend `discoverExperiments` to accept `includeArchived?: boolean` (default false). When false, skip dirs that contain a `.archived` sidecar. Index entries gain a derived `archived: boolean` field (always set when `includeArchived: true`).
- [x] 1.6 Add archive helpers `archiveExperiment(runDir)` / `unarchiveExperiment(runDir)` (touch / unlink the sidecar) — kept as core helpers so web could reuse later.
- [x] 1.7 Add `runDoctor({ projectRoot, includeArchived?, severity? })` — pure scanner: returns `{ scannedAt, projectRoot, issues, summary }` per the spec rule set. No fs writes.
- [x] 1.8 ~~Update `createExperimentScaffold`'s `run.sh` template~~ — the helper itself was deleted in this change (no remaining callers after `memon new` CLI and web `+ New experiment` button were removed).
- [ ] 1.9 Unit tests: `loadCliContext` (precedence + mutual exclusion), `scanProjectRoot` (mock/project-a fixture), `discoverExperiments` archive filter, `runDoctor` rule firing. **Deferred** — covered transitively by live CLI smoke (scan/doctor/archive all run end-to-end against `mock/project-a`); revisit alongside §6 in a follow-up test round.

## 2. CLI: `--project-root` mode + archive filter for read commands

- [x] 2.1 Wire `--project-root <path>` into `commander` global options
- [x] 2.2 `list` / `show` / `search` / `hypo list` / `hypo show`: route through `loadCliContext` so any of them works without `config.yml`. (`memon new` was removed in this change — run dirs are now self-created by each script.)
- [x] 2.3 Mutual exclusion: when both `--project-root` and `--config` (or `--project NAME`) are set, exit 2 with `BAD_REQUEST` JSON to stderr
- [x] 2.4 Add `--include-archived` and `--archived-only` flags to `list` / `show` / `search` / `scan` / `hypo *` / `journal read` / `doctor`. Default behavior excludes archived. `--archived-only` is mutually exclusive with `--include-archived`.

## 3. CLI: new read commands

- [x] 3.1 `memon scan <project-root>` — calls `scanProjectRoot`, prints JSON; `--format human` emits a quick table summary (#exps, #hypotheses, last digest)
- [x] 3.2 `memon journal read --project-root <p> [--since ISO] [--tag T] [--experiment-id ID] [--limit N]`
- [x] 3.3 `memon hypotheses read --project-root <p>` — JSON shape exactly equal to `/api/hypotheses`

## 4. CLI: new write commands

- [x] 4.1 `memon journal append --project-root <p> --tag <T> --body <B> [--experiment-id <id>] [--at <ISO>]` — explicitly rejects `--tag STATUS`
- [x] 4.2 `memon journal digest-mark --project-root <p> --at <ISO>` — calls `updateLastDigestAt`; ISO validation
- [x] 4.3 `memon experiment status set <id> --project-root <p> --to <STATUS> --expected-mtime <ms>` — read README, mtime check, write atomically, append `[STATUS]`; exit 9 on conflict with current content on stdout
- [x] 4.4 `memon experiment readme write <id> --project-root <p> --expected-mtime <ms> [--expected-hash <sha1>]` — read content from stdin, mtime + optional hash check, atomic write, conditional `[STATUS]` event
- [x] 4.5 `memon experiment archive <id> --project-root <p>` — touch `<runDir>/.archived` + append `[ARCHIVE]` event; idempotent (already archived → exit 0 with `noop: true`)
- [x] 4.6 `memon experiment unarchive <id> --project-root <p>` — unlink `.archived` + append unarchive note; idempotent
- [x] 4.7 `memon doctor --project-root <p> [--include-archived] [--severity info|warn|error]` — calls `runDoctor`, prints structured issues; exit 1 if any `severity: error`, else 0

## 5. Stable exit-code dictionary

- [x] 5.1 Centralize exit codes in `packages/cli/src/lib/exit-codes.ts` (`SUCCESS=0`, `GENERIC=1`, `USAGE=2`, `NOT_FOUND=4`, `CONFLICT=9`, `FORBIDDEN=13`)
- [x] 5.2 Centralize structured-error emission in `packages/cli/src/lib/emit-error.ts` so every command goes through the same code → stderr → exit path
- [x] 5.3 Audit existing commands and route their failures through the new helper

## 6. Tests (fixture-based, no fs mocks)

- [ ] 6.1 `packages/cli/test/scan.test.ts` — scan `mock/project-a`, assert JSON shape (5 experiments, 6 hypotheses, journal events present)
- [ ] 6.2 `packages/cli/test/journal-append.test.ts` — copy fixture to tmpdir, append a NOTE, assert: file gained one line, frontmatter unchanged, stdout JSON
- [ ] 6.3 `packages/cli/test/journal-append.test.ts` — STATUS tag rejected with exit 2 + `BAD_REQUEST`
- [ ] 6.4 `packages/cli/test/digest-mark.test.ts` — frontmatter `last_digest_at` updates, event lines byte-identical
- [ ] 6.5 `packages/cli/test/status-set.test.ts` — happy path: status changes, JOURNAL gains `[STATUS]` line, mtime returned
- [ ] 6.6 `packages/cli/test/status-set.test.ts` — mtime conflict: exit 9, current content on stdout, file untouched
- [ ] 6.7 `packages/cli/test/readme-write.test.ts` — stdin content, atomic write, JOURNAL conditional append
- [ ] 6.8 `packages/cli/test/cli-context.test.ts` — `--project-root` bypasses config; mutual-exclusion exits 2
- [ ] 6.9 `packages/cli/test/archive.test.ts` — archive creates `.archived`, doesn't touch README mtime, appends `[ARCHIVE]` event; subsequent `list` excludes the run; `--include-archived` shows it back with `archived: true`
- [ ] 6.10 `packages/cli/test/doctor.test.ts` — fixture with one FINISHED-no-Result + one PARSE_ERROR + one STALE_RUNNING. Assert issues array shape; assert exit 1 (because of PARSE_ERROR); assert `--severity warn` filters out info; assert `--include-archived` includes archived runs in the scan

## 7. Documentation

- [x] 7.1 README: add a "CLI for skills" section listing every new command with a 1-line agent-style example
- [x] 7.2 README: explicit table of exit codes (mirror spec) so skill authors can copy
- [x] 7.3 README: note that `--project-root` is the recommended skill mode (no `config.yml` dependency)
- [x] 7.4 Note in README that the scan cache is a deferred opt-in (env `MEMON_SCAN_CACHE=1` reserved)
- [x] 7.5 README: brief paragraph on archive semantics — `.archived` sidecar, default-hidden, JOURNAL `[ARCHIVE]` audit trail
- [x] 7.6 README: brief paragraph on shell-script header convention (one-line `# <purpose>` at the top of each script in a run dir; refer to upstream `write-shell-script` template for Style A/B body shape)

## 8. Validation

- [x] 8.1 `pnpm typecheck` clean
- [x] 8.2 `pnpm test` green (existing 164 + new ~10)
- [x] 8.3 `openspec validate add-skills-cli --type change` clean
- [x] 8.4 Live smoke: `pnpm --filter @memon/cli build && node packages/cli/dist/index.js scan ./mock/project-a` returns non-empty JSON

## 9. (Deferred — NOT in this change) Optional scan cache

- [ ] 9.1 Implementation of `MEMON_SCAN_CACHE=1` cache layer per the Requirement in spec — left for a follow-up change. Listed here purely as a paper trail; SHALL remain unchecked at archive time.

## 10. Skills (Claude Code SKILL.md files at `packages/skills/memon-*/`)

- [x] 10.1 `memon-write-script/SKILL.md` — adapts the upstream `write-shell-script` template (Style A flat / Style B structured arrays) to memon's run-dir regex (`<RUN_NAME>-yymmdd-hhmmss`). Scripts live in `<projectRoot>/scripts/<area>/`, NOT inside run dirs; each script `mkdir`s its run dir at `<projectRoot>/<LOGS_DIR>/<RUN_NAME>-<TIMESTAMP>/` and emits 3 `[memon] PROJECT_ROOT/RUN_NAME/RUN_DIR=...` lines so callers locate it without filesystem grovelling. The script does NOT write `README.md` — that's `memon-run-experiment`'s job. Layout is flexible (standalone scripts, core+variants, or hybrid all valid). Conventions: one-line `# <purpose>` header, env-overridable `RUN_NAME` for sweeps + `RUN_DIR` for resume, `tee -a` so resume appends to the existing `run.log`.
- [x] 10.2 `memon-run-experiment/SKILL.md` — workflow: pre-launch env+GPU sanity (`which python`, `torch.cuda.is_available()`, `nvidia-smi` for free GPUs) → capture `code.diff` to tempfile (**allowlist-based**, list lives in project's `CLAUDE.md` under `## code.diff allowlist` section; first-time setup is interactive, seeds the section by inspecting `git ls-files` extensions) + wandb pre-flight → launch existing script (env-var overrides for sweeps) → grep `[memon] RUN_DIR=` from output → drop `code.diff`/`code.head` into run dir → wait stable RUNNING (§5) → write RUNNING README (§6, with `--expected-mtime 0` for first write; **deliberately after** stable so we don't claim RUNNING for processes that already died) → periodic check (~120 min via `ScheduleWakeup` under `/loop`) including GPU-utilization sanity → terminal: §9 success path (final README + Chinese walkthrough) or §10 failure path which **branches** on whether §6 ever ran: §10a status-set+optional README append (README exists, `$MTIME` defined), §10b minimal FAILED README from scratch with `--expected-mtime 0` (early crash before §6) → recovery loop §11: read `run.log` with shell idioms (`tail`/`grep`/`awk`), mark prior attempt FAILED via §10a/§10b **before** re-invoking, apply fixes within agent's ability, re-launch.
- [x] 10.3 `memon-append-journal/SKILL.md` — manual + thin wrapper for `memon journal append`. Asks user for tag (`NOTE` / `REQUEST` / etc.), body, optional experiment-id; rejects `STATUS`. Always `--project-root .`. (Renamed from `memon-update-journal` — "update / organize" naming was confusing now that organizing is `memon-digest-journal`'s job.)
- [x] 10.4 `memon-digest-journal/SKILL.md` — folded-in doctor + auto-cadenced. Snapshot `INVOCATION_TIME` + `OBSERVED_LAST_DIGEST_AT` at start (race safety). Run integrity sweep on the 7 doctor codes; walk user through fixes. Determine target file by date: if `D*-<YYYY-MM-DD>.md` exists, append; else new `D<N>-<YYYY-MM-DD>.md`. Write digest covering `(prev_last_digest_at, INVOCATION_TIME]`. Re-read cursor before `digest-mark`; if changed, surface race + abort cursor advance (digest file stays).
- [x] 10.5 `memon-write-report/SKILL.md` — author/update theme-driven report at `docs/reports/R<N>-<slug>.md` with a re-runnable `selector` shell snippet in frontmatter (replaces old `periods` model). Doesn't touch the cursor; reports may overlap freely. New `## Update <date>` sections appended on subsequent invocations.
- [x] 10.6 `memon-propose/SKILL.md` — `memon scan --project-root .` → present open hypotheses + recent experiments + their status → propose 1-3 next experiments with motivation + connection to a hypothesis. **Read-only by default**; user picks one and chains into `memon-write-script` + `memon-run-experiment`.
- [x] 10.6b ~~`memon-doctor/SKILL.md`~~ — **deleted in this change**. Doctor checks are now folded into `memon-digest-journal` (running them outside a digest cycle no longer makes sense; the cursor advance is the natural commit point for the integrity work). The `memon doctor` CLI command stays (used internally by digest skill, also available ad-hoc).
- [x] 10.7 Each SKILL.md follows the same frontmatter shape as `.claude/skills/openspec-*/SKILL.md` (name, description, optional license/metadata). **Invocation policy** baked into frontmatter: skills that perform heavy/multi-step disk writes carry `disable-model-invocation: true` (user-invoked only) — `memon-write-script`, `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`, `memon-propose`. Low-stakes single-event skills omit the field so the model may invoke autonomously — currently only `memon-append-journal`.
- [x] 10.8 `packages/skills/package.json` declares `@memon/skills` (private:true, `files: ["memon-*"]`) and a tiny `index.ts` that exports `SKILLS_DIR = absolute path to the skills tree` so the CLI can locate it regardless of install location.
- [x] 10.9 New CLI command `memon install-skills [--project-root <p>] [--target <path>] [--dry-run]` — strict synchroniser of the `memon-*` namespace under `<projectRoot>/.claude/skills/` (default cwd). Wipes every existing `memon-*` (including ones no longer in the bundled source) and replaces with fresh copies. Non-`memon-*` directories untouched. `--target` and `--project-root` mutually exclusive.
- [x] 10.10 README: short paragraph telling users to run `memon install-skills` from the project root after each memon upgrade.
- [x] 10.11 `packages/skills/README.md` (top-level INDEX) — table of "want to X → use skill Y", invocation policy, cross-skill handoff diagram, file-write boundaries per skill, shared conventions (ISO timestamps, `--project-root .`, English skill bodies + Chinese user dialogue, status enum). Not bundled by `install-skills` (filter is `memon-*` dirs only); pure repo-side documentation.
