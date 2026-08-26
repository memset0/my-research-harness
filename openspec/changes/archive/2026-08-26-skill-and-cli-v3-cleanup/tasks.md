# Implementation tasks

Apply this change in three workstreams. Skills can land independently;
CLI changes should land before the skill rewrites that consume them.

## 1. CLI shortcuts (memon-cli additions)

- [x] 1.1 Created `packages/cli/src/commands/run-resolve-exp.ts`
      exporting `runResolveExp(input: { projectRoot?, cwd, runIdOrDir })`
      that calls `scanProjectRoot` to locate the run, returns exit
      4 if not found, exit 1 (BAD_STATE) + stderr if `frontMatter.experiment`
      is null/empty, otherwise prints the exp id + newline to
      stdout, exit 0.
- [x] 1.2 Created `packages/cli/src/commands/run-warning.ts` exporting
      `runWarningAddViaRun(input: { projectRoot?, cwd, runIdOrDir,
      category, message, note?, expectedMtime?, expectedHash? })`
      that resolves the run, returns exit 1 (BAD_STATE) (`BAD_STATE`) on orphan
      with the link-instruction stderr message, otherwise dispatches
      to the existing `runWarningAdd` from `commands/warning.ts`
      with `runId = exp_id` and `run = run_dir_basename`. Output JSON
      + journal event SHALL be byte-identical to the long-form call.
- [x] 1.3 Wired into `packages/cli/src/index.ts` under the existing
      `run` subcommand group (`run.command('warning add ...')` and
      `run.command('resolve-exp ...')`).
- [x] 1.4 Added `packages/cli/src/commands/run-resolve-exp.test.ts`
      with three scenarios (bound run prints exp id; orphan exits
      9; unknown exits 4).
- [x] 1.5 Added `packages/cli/src/commands/run-warning.test.ts` with
      three scenarios mirroring the spec.
- [x] 1.6 Verified: `pnpm --filter @memon/cli test` 8 files / 62 passed.

## 2. Skill rewrites

### 2.1 memon-append-warning rewrite

- [x] 2.1.1 Dropped the v3-backend-status caveat block.
- [x] 2.1.2 Rewrote "Workflow" v3-only with both forms documented
      (convenience + long form, byte-identical output).
- [x] 2.1.3 Added "Orphan-run guard" sub-section with the
      `memon run resolve-exp` check + Chinese prompt template.
- [x] 2.1.4 No `v2` / `v3` / `FS_CONVENTION_VERSION` in body
      (verified by grep).
- [x] 2.1.5 Skill version 0.2.0 → 0.3.0.

### 2.2 memon-run-experiment restructure

- [x] 2.2.1 Body §0–§11 swept (verified: every remaining
      `v2`/`v3`/`FS_CONVENTION_VERSION` match is inside the
      Migration helpers tail at line 926+).
- [x] 2.2.2 §9 success path — replaced the loose bullet with
      deterministic two-bullet split (实现思路 → exp Method;
      用户注意细节 → exp Caveats) plus closing paragraph noting
      no third loose path.
- [x] 2.2.3 §12 — dropped the v3-backend-status caveat block;
      workflow now uses `memon run warning add` (convenience)
      with the long form documented as equivalent.
- [x] 2.2.4 New `## Migration helpers (legacy projects only)`
      tail section: behind / uninitialised / ahead branches +
      Chinese prompt + migration-specific anti-patterns.
- [x] 2.2.5 Skill version 0.4.0 → 0.5.0.

### 2.3 memon-write-script restructure

- [x] 2.3.1 New `## Identify the parent experiment` section
      inserted between preflight and "Mental model". 3 branches
      (named / implied / explicit none) with `$EXP_BINDING`
      variable carried through.
- [x] 2.3.2 New "Register the script with its parent experiment"
      sub-section under "When you're done" with the exact format
      `- \`<rel-path>\` — <description>` + the read-modify-write
      flow via `memon experiment readme write`.
- [x] 2.3.3 Convention #6 disclaimer dropped (no longer claims
      exp-doc handling is exclusively `memon-run-experiment`'s
      job; this skill now shares the registry-write
      responsibility).
- [x] 2.3.4 Templates untouched — confirmed by reading the diff;
      Style A / Style B / Composability patterns are unchanged.
- [x] 2.3.5 Skill version 0.3.0 → 0.4.0.

## 3. Verification

- [x] 3.1 `pnpm --filter @memon/cli test` 8 files / 62 passed.
- [x] 3.2 `pnpm --filter @memon/cli typecheck` clean.
- [x] 3.3 `pnpm --filter @memon/web typecheck` clean.
- [x] 3.4 Manual skill review verified:
      - `memon-append-warning`: zero `v2`/`v3`/`FS_CONVENTION_VERSION`
        matches.
      - `memon-run-experiment`: matches ONLY at lines 944, 975,
        993 (all inside `## Migration helpers (legacy projects
        only)` tail starting line 926).
      - `memon-write-script`: zero matches.
- [x] 3.5 Live CLI smoke against `mock/project-a`:
      - `memon run resolve-exp bf16-flow-matching-260503-093000`
        prints `E0005-bf16-flow-matching` (one line) + exit 0.
      - `memon run resolve-exp no-such-run-260101-000000` exits
        4 with NOT_FOUND error envelope on stderr.
      - Orphan path covered by unit tests
        (`run-resolve-exp.test.ts`).
- [x] 3.6 `openspec validate skill-and-cli-v3-cleanup --type change`
      clean.
