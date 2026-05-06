# Implementation tasks

Apply this change in three workstreams. Skills can land independently;
CLI changes should land before the skill rewrites that consume them.

## 1. CLI shortcuts (memon-cli additions)

- [ ] 1.1 Create `packages/cli/src/commands/run-resolve-exp.ts`
      exporting `runResolveExp(input: { projectRoot?, cwd, runIdOrDir })`
      that calls `scanProjectRoot` to locate the run, returns exit
      4 if not found, exit 9 + stderr if `frontMatter.experiment`
      is null/empty, otherwise prints the exp id + newline to
      stdout, exit 0.
- [ ] 1.2 Create `packages/cli/src/commands/run-warning.ts` exporting
      `runWarningAddViaRun(input: { projectRoot?, cwd, runIdOrDir,
      category, message, note?, expectedMtime?, expectedHash? })`
      that resolves the run, returns exit 9 (`BAD_STATE`) on orphan
      with the link-instruction stderr message, otherwise dispatches
      to the existing `runWarningAdd` from `commands/warning.ts`
      with `runId = exp_id` and `run = run_dir_basename`. Output JSON
      + journal event SHALL be byte-identical to the long-form call.
- [ ] 1.3 Wire into `packages/cli/src/index.ts` under the existing
      `run` subcommand group (`run.command('warning add ...')` and
      `run.command('resolve-exp ...')`).
- [ ] 1.4 Add `packages/cli/src/commands/run-resolve-exp.test.ts`
      with three scenarios (bound run prints exp id; orphan exits
      9; unknown exits 4).
- [ ] 1.5 Add `packages/cli/src/commands/run-warning.test.ts` with
      three scenarios mirroring the spec.
- [ ] 1.6 Verify: `pnpm --filter @memon/cli test` clean.

## 2. Skill rewrites

### 2.1 memon-append-warning rewrite

- [ ] 2.1.1 Drop the v3-backend-status caveat block (~lines 62-80
      of current SKILL.md).
- [ ] 2.1.2 Rewrite "Workflow" to v3-only: `memon experiment warning
      add <exp-id> --run <run-dir> ...` OR convenience `memon run
      warning add <run-dir> ...`.
- [ ] 2.1.3 Add "Orphan-run guard" sub-section: skill MUST check
      `experiment:` field via `memon run resolve-exp <run>` before
      invoking warning add; if orphan, prompt user to bind via
      `memon experiment link` and STOP.
- [ ] 2.1.4 Strip every remaining `v2` / `v3` /
      `FS_CONVENTION_VERSION` from body outside fenced code. If
      anything legacy-related survives, move to a
      `## Migration helpers (legacy projects only)` tail section.
- [ ] 2.1.5 Bump `metadata.version` in frontmatter.

### 2.2 memon-run-experiment restructure

- [ ] 2.2.1 Body sweep §0–§11: remove every `v2` / `v3` /
      `FS_CONVENTION_VERSION` outside fenced code.
- [ ] 2.2.2 §10 (terminal — success path) — replace the
      "实现思路或想让用户注意的细节, 如果两边都没合适的位置写"
      bullet with two deterministic bullets:
      - 实现思路 / 设计 rationale → parent exp doc's `## Method`
      - 让用户注意的细节 / caveat → parent exp doc's `## Caveats`
- [ ] 2.2.3 §12 — drop "v3-vs-legacy invocation" note; assume v3
      form per the warning skill rewrite.
- [ ] 2.2.4 New `## Migration helpers (legacy projects only)`
      section at the end. Brief — just detection + when to invoke
      `memon-migrate-fs` + how to ask the user.
- [ ] 2.2.5 Bump `metadata.version` in frontmatter.

### 2.3 memon-write-script restructure

- [ ] 2.3.1 New §1 "Identify the parent experiment" inserted
      after preflight, before "Mental model". Three branches:
      a. Exp explicitly named — read its `## Method`
      b. Exp implied but absent — ask user; create on yes
      c. Explicitly no exp — skip entirely
- [ ] 2.3.2 Augment "When you're done": if bound, append the
      script's `- \`<rel-path>\` — <one-sentence purpose>` line
      to the exp's `## Method` via `memon experiment readme write`.
- [ ] 2.3.3 Drop the existing "exp-doc handling is
      `memon-run-experiment`'s job" disclaimer line.
- [ ] 2.3.4 No template changes — Style A / Style B /
      Composability patterns unaffected.
- [ ] 2.3.5 Bump `metadata.version` in frontmatter.

## 3. Verification

- [ ] 3.1 `pnpm --filter @memon/cli test` clean (with new tests).
- [ ] 3.2 `pnpm --filter @memon/cli typecheck` clean.
- [ ] 3.3 `pnpm --filter @memon/web typecheck` clean (sanity).
- [ ] 3.4 Manual skill review: `grep -E 'v2|v3|FS_CONVENTION_VERSION'`
      on each rewritten skill — matches ONLY inside the
      `## Migration helpers (legacy projects only)` tail (or no
      matches if the skill has no legacy guidance).
- [ ] 3.5 Live CLI smoke: `memon run resolve-exp <bound-run>
      --project-root mock/project-a` returns exp id; same on a
      known orphan returns exit 9.
- [ ] 3.6 `openspec validate skill-and-cli-v3-cleanup --type change`
      clean.
