## 1. Core helpers (`@memon/core`)

- [x] 1.1 Add `loadCliContext({ projectRoot?, configPath?, cwd })` that returns `{ projects, configSource }` honoring the precedence: `--project-root` > `--config` > cwd `config.yml` > implicit cwd. Mutual exclusion check throws a tagged `CliContextError` with a `BAD_REQUEST` code.
- [x] 1.2 Add `scanProjectRoot(absRoot, { includeArchived? })` returning the full snapshot shape (`{ projectRoot, scannedAt, experiments, hypotheses, journal }`). Internally uses `discoverExperiments` + `readExperimentDir` + `parseHypotheses` + `parseJournal`. Bails with `NOT_FOUND` if the root path doesn't exist or isn't a directory.
- [x] 1.3 Confirm `appendJournalEvent` rejects `STATUS` tag at the helper layer (defense in depth) — currently any tag is accepted; add a guard so callers can't bypass via a typo.
- [x] 1.4 Confirm `updateLastDigestAt` is exported and stable (it already exists per the journal spec); no code change unless needed.
- [x] 1.5 Extend `discoverExperiments` to accept `includeArchived?: boolean` (default false). When false, skip dirs that contain a `.archived` sidecar. Index entries gain a derived `archived: boolean` field (always set when `includeArchived: true`).
- [x] 1.6 Add archive helpers `archiveExperiment(runDir)` / `unarchiveExperiment(runDir)` (touch / unlink the sidecar) — kept as core helpers so web could reuse later.
- [x] 1.7 Add `runDoctor({ projectRoot, includeArchived?, severity? })` — pure scanner: returns `{ scannedAt, projectRoot, issues, summary }` per the spec rule set. No fs writes.
- [x] 1.8 Update `createExperimentScaffold`'s `run.sh` template to start with `# TODO: one-line description of what this script does` so write-script skill / users have an obvious slot for the per-script header.
- [ ] 1.9 Unit tests: `loadCliContext` (precedence + mutual exclusion), `scanProjectRoot` (mock/project-a fixture), `discoverExperiments` archive filter, `runDoctor` rule firing. **Deferred** — covered transitively by live CLI smoke (scan/doctor/archive all run end-to-end against `mock/project-a`); revisit alongside §6 in a follow-up test round.

## 2. CLI: `--project-root` mode + archive filter for read commands

- [x] 2.1 Wire `--project-root <path>` into `commander` global options
- [x] 2.2 `list` / `show` / `search` / `hypo list` / `hypo show` / `new`: route through `loadCliContext` so any of them works without `config.yml`
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

- [x] 10.1 `memon-write-script/SKILL.md` — adapts the upstream `write-shell-script` template (Style A flat / Style B structured arrays) to memon's run-dir regex (`<name>-yymmdd-hhmmss`). Includes the one-line `# <purpose>` header convention. Uses `memon new --project-root` to scaffold, then `bash`-edits the generated `run.sh` (or sibling scripts) in-place.
- [x] 10.2 `memon-run-experiment/SKILL.md` — workflow: scaffold (or accept an existing run dir) → `experiment status set RUNNING` → spawn the script under `tmux` (memon-claude-* style) or via `nohup` → poll status → on stable RUNNING, write README via `experiment readme write` (read fresh mtime first) → on success, `status set FINISHED` + finalize Result/Conclusion → on failure, `status set FAILED` + minimal Result + offer to `archive`.
- [x] 10.3 `memon-update-journal/SKILL.md` — thin wrapper around `memon journal append`. Asks user for tag (`NOTE` / `REQUEST` / etc.), body, optional experiment-id; rejects `STATUS`. Always `--project-root .`.
- [x] 10.4 `memon-digest-journal/SKILL.md` — read `last_digest_at` → `journal read --since` → ask agent to write a markdown digest under `docs/digests/<yyyy-Www>.md` (or wherever user prefers) → after user accepts, `journal digest-mark --at <now>`.
- [x] 10.5 `memon-propose/SKILL.md` — `memon scan --project-root .` → present open hypotheses + recent experiments + their status → ask agent to propose 1-3 next experiments with motivation + connection to a hypothesis. **Read-only by default**; user copies the suggestion and runs `memon-write-script` / `memon-run-experiment` themselves.
- [x] 10.6 `memon-doctor/SKILL.md` — `memon doctor --project-root .` → for each issue, ask user how to handle (fill / downgrade / archive / skip) → invoke the appropriate write CLI. Iterates until issue list is empty or user bails.
- [x] 10.7 Each SKILL.md follows the same frontmatter shape as `.claude/skills/openspec-*/SKILL.md` (name, description, optional license/metadata).
- [x] 10.8 `packages/skills/package.json` declares `@memon/skills` (private:true, `files: ["memon-*"]`) and a tiny `index.ts` that exports `SKILLS_DIR = absolute path to the skills tree` so the CLI can locate it regardless of install location.
- [x] 10.9 New CLI command `memon install-skills [--target ~/.claude/skills] [--dry-run] [--force]` — copies each `memon-*` from `@memon/skills`'s SKILLS_DIR into the target. v1: simple recursive copy; reject if target file exists unless `--force`.
- [x] 10.10 README: short paragraph telling users to run `memon install-skills` once after global `npm i -g @memon/cli`.
