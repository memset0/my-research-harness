## 1. Bump the constant + author the migration guide

- [x] 1.1 Bump `packages/core/src/version.ts`: `FS_CONVENTION_VERSION` from `1` to `2`. Update the inline comment if it mentions the current value.
- [x] 1.2 Author `packages/core/migrations/v1-to-v2.md` to the meta-spec at `openspec/specs/fs-migration-guide-authoring/spec.md`. Sections in this exact order: `Background / Why`, `Detection`, `Diff (v1 → v2)`, `Target State (v2 Summary)`, `Verification`, `Rollback Notes`, `Edge Cases`. Detection bullets are literal shell commands; verification is a fenced `bash` block where every line is a comment or a runnable command, every successful command prints `OK`, and any non-zero exit aborts. Rollback Notes contains the literal string `chore(memon): migrate FS convention v1 -> v2` (ASCII arrow). Edge Cases addresses all four canonical situations from the meta-spec.
- [x] 1.3 Update `packages/core/migrations/README.md` if it has a per-version table or imperative-prose-style reminder that needs the new entry. (Per the meta-spec, the README must document the imperative-prose rule and reference `fs-migration-guide-authoring`; today's content satisfies this — verify, don't rewrite.)

## 2. Core package — rename literals + helper paths

- [x] 2.1 `packages/core/src/journal/append.ts` and `parse.ts`: replace every `'JOURNAL.md'` literal with `'docs/journal.md'`. Update any inline doc comments that name the path.
- [x] 2.2 `packages/core/src/hypotheses/parse.ts`: replace every `'HYPOTHESES.md'` literal with `'docs/hypotheses.md'`.
- [x] 2.3 `packages/core/src/cli/scan.ts`, `packages/core/src/cli/doctor.ts`: same literal replacement; update any doctor messages that print the path.
- [x] 2.4 `packages/core/src/time.ts` (only if it composes a path; if it's a comment-only mention, leave a follow-up comment but still update for consistency).
- [x] 2.5 Run `grep -rn "JOURNAL\.md\|HYPOTHESES\.md" packages/core/src` — only the historical content of fixtures or test snapshots that are intentionally testing v1 detection should remain.

## 3. CLI package — rename literals + tests

- [x] 3.1 `packages/cli/src/commands/journal.ts`, `hypo.ts`, `hypotheses.ts`, `experiment.ts`, `warning.ts`, plus the corresponding `*.test.ts`: replace every literal. Where tests construct a v1-style fixture path on a temp dir, change them to the v2 path.
- [x] 3.2 `packages/cli/src/index.ts`: any user-facing help text that names the file paths SHALL be updated.
- [x] 3.3 `pnpm --filter @memon/cli test` clean.

## 4. Web app — runtime helpers, caches, API routes, components

- [x] 4.1 `apps/web/lib/runtime.ts`: update `hypothesesPath()` (lines ~84–93) to return `join(p.root, 'docs', 'hypotheses.md')` and `journalPath()` similarly. Update the cache initialiser around line 138 (`hypothesesPaths` / `journalPaths` array construction).
- [x] 4.2 `apps/web/lib/runtime/file-cache.ts`: any inline path strings.
- [x] 4.3 `apps/web/lib/server/data.ts`, `apps/web/lib/agent-prompt.ts`, `apps/web/lib/agent-prompt.test.ts`, `apps/web/lib/warnings.ts`: literal replacements.
- [x] 4.4 API routes: `apps/web/app/api/hypotheses/route.ts` (+ `route.test.ts`), `apps/web/app/api/journal/route.ts`, `apps/web/app/api/journal/append/route.ts`, `apps/web/app/api/readme/route.ts`, `apps/web/app/api/experiments/[id]/status/route.ts`, `apps/web/app/api/experiments/[id]/warnings/route.ts` (+ `route.test.ts`).
- [x] 4.5 Components: `apps/web/components/hypothesis-view.tsx`, `inbox-shell.tsx`, `warnings-card.tsx` — text that names the file path in user-facing copy SHALL be updated; `<code>` snippets and links SHALL match.
- [x] 4.6 `pnpm --filter @memon/web typecheck` clean.
- [x] 4.7 `pnpm --filter @memon/web test` clean.

## 5. Skills — every literal path mention

- [x] 5.1 `packages/skills/README.md` and every `packages/skills/*/SKILL.md` (memon-write-script, memon-digest-journal, memon-run-experiment, memon-write-report, memon-append-warning, memon-propose, memon-append-journal): replace `JOURNAL.md` → `docs/journal.md` and `HYPOTHESES.md` → `docs/hypotheses.md`. Skills that mention "the journal" without a path do not need editing.
- [x] 5.2 `grep -rn "JOURNAL\.md\|HYPOTHESES\.md" packages/skills/` — output SHALL be empty after this step.

## 6. Mock data

- [x] 6.1 `mkdir -p mock/project-b/docs` (project-a already has `docs/`).
- [x] 6.2 `git mv mock/project-a/JOURNAL.md mock/project-a/docs/journal.md` and same for `HYPOTHESES.md → docs/hypotheses.md`. Same for project-b.
- [x] 6.3 If any test fixture under `apps/web/test` or `packages/*/src/**/*.test.ts` constructs explicit paths against `mock/...`, update them.

## 7. Repo-wide grep audit

- [x] 7.1 `grep -rn "JOURNAL\.md\|HYPOTHESES\.md" packages apps mock --include="*.ts" --include="*.tsx" --include="*.md"` — every match outside `openspec/changes/archive/`, `openspec/specs/fs-migration-guide-authoring/`, `openspec/specs/fs-migration-runtime/`, and `packages/core/migrations/v1-to-v2.md` SHALL be intentional (e.g. an OpenSpec change archive's old proposal). The list is reviewed by hand.
- [x] 7.2 Repeat the same grep against `.claude/skills` (none expected — those are openspec workflow skills, not memon skills) and the repo root files (`README.md`, `CLAUDE.md`).

## 8. Final verification

- [x] 8.1 `pnpm --filter @memon/core build` and `pnpm --filter @memon/core test` clean.
- [x] 8.2 `pnpm --filter @memon/web typecheck && pnpm --filter @memon/web test` clean.
- [x] 8.3 Run the migration guide's `## Verification` block against a freshly-constructed v1 fixture: copy `mock/project-a` to a temp dir, manually move the v2 paths back to v1 to simulate a v1 root, then execute the guide step-by-step; the verification block SHALL print `OK` for every check.
- [x] 8.4 Restart `pnpm dev` and confirm: (a) the dashboard reads `mock/project-a/docs/{journal,hypotheses}.md` correctly (project list, hypotheses page, journal page render); (b) `pnpm --filter @memon/cli memon doctor` against `mock/project-a` reports v2 cleanly.
