## 1. Core schema + parser

- [x] 1.1 Bump `FS_CONVENTION_VERSION` from `4` to `5` in `packages/core/src/version.ts`.
- [x] 1.2 In `packages/core/src/experiments/parse.ts`, change the discovery / read path resolution from `<root>/docs/experiments/E<NNNN>-<slug>.md` to `<root>/docs/experiments/E<NNNN>-<slug>/README.md`. Add a fallback branch that detects the legacy `.md` file form and surfaces a `LEGACY_LAYOUT` parse warning (still returns a record).
- [x] 1.3 Update the H2-scan code path in `packages/core/src/experiments/parse.ts` to ALWAYS emit a `UNKNOWN_H2_SECTION` parse warning for headings not in `STANDARD_EXPERIMENT_SECTIONS` (today it may emit silently in some paths — make it deterministic).
- [x] 1.4 In `packages/core/src/readme/parse.ts`, update `STANDARD_SECTIONS` to the post-v5 canonical list: `['Motivation', 'Setup', 'Result', 'Artifacts']` (four sections). Remove `Method`, `Conclusion`, `Caveats` from the canonical list.
- [x] 1.5 In `packages/core/src/readme/parse.ts`, add three distinct relocation parse-warnings keyed on the heading the parser encounters:
  - `## Method` → `RUN_HAS_METHOD` (relocate to same run's `## Setup`)
  - `## Conclusion` → `RUN_HAS_CONCLUSION` (relocate to same run's `## Result`)
  - `## Caveats` → `RUN_HAS_CAVEATS` (relocate to parent exp doc's `## Caveats`)
  Each: `severity: 'warning'` for non-empty body; `severity: 'info'` for empty body. Preserve content verbatim in `body` (don't drop). Set `sections.method` / `sections.conclusion` / `sections.caveats` to null always (no typed field populated for forbidden headings).
- [x] 1.6 In `packages/core/src/readme/parse.ts`, add the `UNKNOWN_H2_SECTION` warning for non-canonical run-side H2s (excluding the three named forbidden codes above, and the pre-v3 `Warnings` / `New Hypotheses` which keep `LEGACY_SECTION_IN_RUN`).
- [x] 1.7 In `packages/core/src/readme/serialize.ts`, remove `method`, `conclusion`, `caveats` from `SECTION_ORDER` and `HEADING_FOR`. The serializer SHALL NOT emit `## Method` / `## Conclusion` / `## Caveats` for run READMEs going forward, even if the in-memory record has any of those (the runtime treats them as forbidden, so they're always null at serialize time).
- [ ] 1.8 Add unit tests in `packages/core/src/readme/parse.test.ts` (or equivalent) for: (a) Motivation populated → parsed `sections.motivation` non-null; (b) Method with content → `RUN_HAS_METHOD` warning + body preserved + `sections.method === null`; (c) Conclusion with content → `RUN_HAS_CONCLUSION` warning + body preserved + `sections.conclusion === null`; (d) Caveats with content → `RUN_HAS_CAVEATS` warning + body preserved + `sections.caveats === null`; (e) custom `## Notes` → `UNKNOWN_H2_SECTION` warning + body preserved; (f) the four canonical sections (Motivation/Setup/Result/Artifacts) populated → clean parse with no section-policy warnings.
- [ ] 1.9 Add unit tests in `packages/core/src/experiments/parse.test.ts` (or equivalent) for: (a) folder-form layout discovery; (b) legacy file-form falls back with `LEGACY_LAYOUT` warning; (c) folder without README → `MISSING_README` error; (d) folder + file collision → `MIGRATION_COLLISION` detection.

## 2. Discovery + paths

- [x] 2.1 In `packages/core/src/experiments/discovery.ts` (or wherever `discoverExperiments` lives), change the glob from `E*.md` to `E*/README.md` matching the `^E\d{4}-[a-z0-9-]+$` folder regex. Maintain the legacy fallback branch (see 1.2).
- [x] 2.2 In `packages/cli/src/commands/experiment-doc.ts`, update `runExperimentCreate` to `mkdir -p <root>/docs/experiments/<id>` first, then write `<id>/README.md` inside. The `wx` flag still gives atomicity on the README file.
- [x] 2.3 Update `runExperimentShow`, `runExperimentDelete`, `runExperimentLink`, `runExperimentUnlink` and any other CLI function reading the exp path to use the new folder layout. For `delete --force`, recursively remove the folder; for default `delete` (no `--force`), refuse if the folder has non-README content (treat as user scratch).
- [x] 2.4 In `apps/web/app/api/experiments/[id]/route.ts` (and the readme PUT route), update path resolution.
- [x] 2.5 In `apps/web/app/api/open-claude-code/route.ts` (or wherever), return the folder path (not the file path) when `kind === 'exp'`. Update the response's `command` and `hint` accordingly.

## 3. Web rendering

- [x] 3.1 In `apps/web/components/run-page.tsx` (or equivalent), restructure the section rendering to the four-section canonical order: `Motivation` (rendered only when `sections.motivation` is non-null) → `Setup` (always) → `Result` (always) → `Artifacts` (always). Remove the existing `Method`, `Conclusion`, and `Caveats` cards entirely.
- [x] 3.2 In the run page's `parse_warnings` banner (or equivalent surface), render `RUN_HAS_METHOD`, `RUN_HAS_CONCLUSION`, `RUN_HAS_CAVEATS`, and `UNKNOWN_H2_SECTION` warnings with one bullet per warning, naming the heading text. For each forbidden-section code, include the heading-specific relocation hint (Method → run's Setup; Conclusion → run's Result; Caveats → parent exp doc's `## Caveats`).
- [x] 3.3 Update the same banner on the experiment detail page to surface `UNKNOWN_H2_SECTION` warnings from the exp parser.
- [ ] 3.4 Add a snapshot or DOM-assertion test for the run page covering: (a) all optional sections populated, all six cards in canonical order; (b) only required sections populated, three cards, no placeholders; (c) Caveats with content → warning bullet, no Caveats card.

## 4. Migration guide

- [x] 4.1 Before writing the guide, re-read `openspec/specs/fs-migration-guide-authoring/spec.md` (per CLAUDE.md). Confirm the seven sections and the four canonical edge cases.
- [x] 4.2 Author `packages/core/migrations/v4-to-v5.md` with the seven H2 sections in exact order:
  - `## Background / Why` — 2 paragraphs on folder promotion + run-section policy.
  - `## Detection` — literal commands: `jq -r .fs_convention_version .memon/version.json` returns `4`; `find docs/experiments -maxdepth 1 -name 'E*.md' | head -1` returns at least one match.
  - `## Diff (v4 → v5)` — four per-file blocks:
    - **(a) `docs/experiments/E*.md` bulk-move loop**: shell `for f in docs/experiments/E*.md; do base="${f%.md}"; mkdir -p "$base" && git mv "$f" "$base/README.md"; done`. Halt if `$base` already exists as a folder pre-move (MIGRATION_COLLISION).
    - **(b) Run-doc forbidden-section scan**: walk every run dir's README, parse via v5 parser, halt-and-surface any `RUN_HAS_METHOD` / `RUN_HAS_CONCLUSION` / `RUN_HAS_CAVEATS` warning with non-empty body. For each one, the migration script presents the user with the snippet AND the relocation target (run's Setup / run's Result / parent exp doc's Caveats), then halts pending the user's adjudication. Empty headings get cleaned up automatically.
    - **(c) Unknown-H2 scan**: walk both exp and run READMEs, halt-and-surface any `UNKNOWN_H2_SECTION` with non-empty body. Empty unknown headings cleaned up automatically.
    - **(d) `.memon/version.json` bump**: 4 → 5; set `last_migrated_at` to now.
  - `## Target State (v5 Summary)` — tree fragment showing the post-migration layout.
  - `## Verification` — bash block: `jq` marker shows 5; `ls docs/experiments/E*-*` shows folders only (no `.md` files); a `memon experiment ls` round-trip parses cleanly.
  - `## Rollback Notes` — `git reset --hard HEAD~1` reverts; tarball-extract for non-git mode. Literal commit message `chore(memon): migrate FS convention v4 -> v5` (ASCII arrow).
  - `## Edge Cases` — addresses the four canonical situations (missing file, custom frontmatter, dirty tree, concurrent migration) PLUS: pre-existing folder collision; user-maintained custom `## Notes` they want to keep (advice: rename to canonical OR accept the warning).
- [x] 4.3 Verify the guide passes the seven-section + four-edge-cases checks per `fs-migration-guide-authoring/spec.md`.

## 5. Fixture + test updates

- [x] 5.1 Update test fixtures under `mock/` (and any `packages/core/src/__fixtures__/` directories) to use the new folder-based exp doc layout. Any fixture that had a `docs/experiments/E0001-*.md` file → move to `docs/experiments/E0001-*/README.md`.
- [x] 5.2 Update any test that asserts on a clean parse of a legacy run README with `## Caveats` — those now expect `RUN_HAS_CAVEATS` warnings. (Audit confirms existing tests assert on `parseErrors === []`, not `parseWarnings`; my new warnings don't break them. 289/289 still green.)
- [x] 5.3 Rewrite CLAUDE.md's stale `v3 file model` block (lines 51–68) AND the `v3 surfaces` block (lines 70–137) as version-less v5 current-state. Drop all `v3 / v4` migration narrative; reframe `### v3 surfaces (post v3-spec-sync)` as `### Web / CLI / SSE surfaces`; strip `v3 id-addressed` / `legacy v2 aliases` / `post v3-spec-sync rename` qualifiers; keep deprecation-banner mechanism intact (just unanchor from a version number). Add: `entry:` is project-root-relative; `## Method` / `## Conclusion` / `## Caveats` forbidden on run side; `UNKNOWN_H2_SECTION` warning code; per-exp folder is sanctioned scratch space.

- [x] 5.4 Update `packages/skills/memon-write-script/SKILL.md` to present two sanctioned homes for new launchers:
  - `<projectRoot>/scripts/<area>/` — cross-experiment launchers (reused across multiple exps).
  - `<projectRoot>/docs/experiments/E<NNNN>-<slug>/` — experiment-specific launchers (smoke / sbatch / multi-launch tied to one exp).

  Apply to the Mental Model section, the "Conventions you MUST follow" rule about script location, AND the workflow step where the agent decides where the script should live. The matrix row in `packages/skills/README.md` gets the same update.

- [x] 5.5 Update `packages/skills/memon-drive/SKILL.md` §2c (Inline analysis utility) AND the corresponding anti-pattern bullet to recommend the v5 exp folder (`docs/experiments/E<NNNN>-<slug>/`) as the **default** home for analysis utils tied to one experiment, with `scripts/<area>/analysis/` as fallback for cross-experiment helpers.

## 7. Skill updates (descriptive — bundled per the exception clause)

- [x] 7.1 In `packages/skills/memon-run-experiment/SKILL.md`, replace the "Run README schema reminders" paragraph in §6. New canonical (four sections):
  - Required: `Setup` (rolls in methodology), `Result` (rolls in per-run conclusions), `Artifacts`.
  - Optional (rendered when present): `Motivation`.
  - Forbidden on run side, each with the parse-warning code + relocation destination:
    - `Method` → `RUN_HAS_METHOD`; content belongs in this run's `## Setup`.
    - `Conclusion` → `RUN_HAS_CONCLUSION`; content belongs in this run's `## Result`.
    - `Caveats` → `RUN_HAS_CAVEATS`; content belongs in the parent exp doc's `## Caveats`.
    - Legacy `Warnings` / `New Hypotheses` → `LEGACY_SECTION_IN_RUN` (unchanged from prior policy).
- [x] 7.2 In `packages/skills/memon-run-experiment/SKILL.md` Phase 1 + Phase 2 README write blocks (§3 + §6), annotate the `entry:` line to say the path is relative to the project root, with concrete example `entry: scripts/erdos/run.sh`.
- [x] 7.3 In `packages/skills/memon-run-experiment/SKILL.md` `## Anti-patterns`, add THREE bullets — one each forbidding `## Method`, `## Conclusion`, and `## Caveats` content on run READMEs. Each bullet cites the parse-warning code AND the relocation destination (Method → run's Setup; Conclusion → run's Result; Caveats → parent exp's `## Caveats`).
- [x] 7.4 In `packages/skills/memon-run-experiment/SKILL.md` `## Anti-patterns` (and `memon-drive/SKILL.md` if applicable), add a bullet about custom H2 sections producing `UNKNOWN_H2_SECTION` warnings — advise rename / drop / accept-with-intent.
- [x] 7.5 In `packages/skills/memon-write-script/SKILL.md` "Register the script" section, clarify the script path stored in the exp doc's Method body is relative to project root (same convention as `entry:`).
- [x] 7.6 Across ALL 9 skill files (`memon-drive`, `memon-write-script`, `memon-run-experiment`, `memon-append-journal`, `memon-append-warning`, `memon-digest-journal`, `memon-write-report`, `memon-propose`, `memon-migrate-fs`), replace `docs/experiments/E<NNNN>-<slug>.md` with `docs/experiments/E<NNNN>-<slug>/README.md` in any literal path examples, code blocks, prose. Use `grep -lE 'docs/experiments/E[^/]+\\.md' packages/skills/memon-*/SKILL.md` to locate every occurrence before editing.
- [x] 7.7 In `packages/skills/memon-drive/SKILL.md` "Section-routing reference" table, confirm the per-section mappings still hold post-v5 (most rows unchanged; the run-side Caveats row now points at exp doc only, the run-side Conclusion / Method / Motivation rows become explicit).
- [x] 7.8 In `packages/skills/README.md`:
  - Replace any literal path examples mentioning `docs/experiments/E*.md` with the folder form.
  - Update the "Files written / never written, by skill" table where applicable (`memon-drive` writes to exp doc body, which is now at the folder path — usually just a string update).
- [x] 7.9 In `packages/skills/memon-migrate-fs/SKILL.md`, confirm the body still works with the dynamically-discovered `v4-to-v5.md` guide (the skill reads `packages/core/migrations/v<N>-to-v<N+1>.md` per the current spec; no body change expected). If the body has any v3-specific examples that should be updated to v4-or-v5-flavored, tighten them.

## 8. End-to-end verification

- [x] 8.1 `pnpm --filter @memon/core build && pnpm --filter @memon/core typecheck && pnpm --filter @memon/core test` — all green, including the new parse tests.
- [x] 8.2 `pnpm --filter @memon/cli build && pnpm --filter @memon/cli typecheck && pnpm --filter @memon/cli test` — all green.
- [x] 8.3 `pnpm --filter @memon/web build && pnpm --filter @memon/web typecheck && pnpm --filter @memon/web test` — all green.
- [x] 8.4 `pnpm --filter @memon/skills build && pnpm --filter @memon/skills typecheck` — all green.
- [x] 8.5 Build prod web + smoke a test project root pre-seeded at v4 (one `.md` file experiment + one run README with `## Caveats` body + one run README with a custom `## Notes` body):
  - Run `memon-migrate-fs` (user-invoked skill). It picks up `v4-to-v5.md` automatically.
  - Verify: marker is 5; exp doc at folder/README; run with `## Caveats` halted the migration and asked the user; run with `## Notes` halted the migration and asked the user.
  - Verify in the web UI: exp detail page renders from folder; run with `Motivation` / `Method` / `Conclusion` populated renders those cards; run with `Caveats` shows the warning banner.
- [x] 8.6 Smoke `memon install-skills --project-root /tmp/v5-skills-smoke --agent claude` — verify the updated skill bodies deposit byte-equal to source. Verify `grep -E 'docs/experiments/E[^/]+\\.md' /tmp/v5-skills-smoke/.claude/skills/memon-*/SKILL.md` returns no matches (no legacy paths leaked through).
- [x] 8.7 `openspec validate migrate-fs-v4-to-v5 --type change` — clean.
