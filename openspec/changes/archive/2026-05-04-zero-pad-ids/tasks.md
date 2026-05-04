## 1. `@memon/core` — strict ID helpers + parser updates

- [x] 1.1 Create `packages/core/src/ids.ts`: `ID_WIDTH = 4`, `ID_PREFIXES = ['H', 'D', 'R']`, `padId(prefix, n) → 'H0001'`, `parseId(s) → {prefix, n} | null` (strict — only accepts canonical), `ID_REGEX = /^([HDR])(\d{4})$/`. Unit tests for round-trip + rejection of unpadded / overlong / wrong-prefix inputs.
- [x] 1.2 Update `packages/core/src/hypotheses/parse.ts` to require `^## H(\d{4})\.\s+` for entry headings. Anything else surfaces a structured `INVALID_HYPOTHESIS_ID` warning and the entry is skipped (not indexed). Out-of-range `H0000` / `H10000+` also rejected.
- [x] 1.3 Update `packages/core/src/readme/parse.ts` so frontmatter `hypotheses` array drops elements that don't match `^H\d{4}$` and surfaces a per-element `INVALID_HYPOTHESIS_REF` warning. Valid elements stay; the bad ones disappear from the parsed array.
- [x] 1.4 Update `packages/core/src/readme/serialize.ts` so any system-driven write of the `hypotheses` frontmatter array goes through `padId('H', n)` (or asserts the input is already canonical). Serializer SHALL fail loudly on a non-canonical input rather than emitting garbage.
- [x] 1.5 Update `packages/core/src/types.ts` doc comments on hypothesis ID strings (`// 'H1'` → `// 'H0001'`) and tighten `Experiment.hypotheses` JSDoc to "canonical padded form".
- [x] 1.6 Tests: `packages/core/src/hypotheses/parse.test.ts` — padded headings parse, unpadded rejected with named warning, out-of-range rejected, duplicates surface `DUPLICATE_HYPOTHESIS_ID`. `packages/core/src/readme/parse.test.ts` — `[H0001, H0003]` parses; `[H0001, H3, H0042]` parses to `["H0001", "H0042"]` with one warning.
- [x] 1.7 Repo-grep `packages/core/src` for stragglers: `grep -RnE '\b[HDR][0-9]{1,3}\b' packages/core/src/` — every match should be either a strict-regex-rejection test fixture, or rewritten to padded.

## 2. `@memon/cli` — strict input validation

- [x] 2.1 `memon hypo show <id>`: validate input with `parseId(input)`; if null, exit 2 with stderr `{"error":{"code":"BAD_REQUEST","message":"hypothesis id must be canonical 4-digit form (e.g. H0003)"}}`.
- [x] 2.2 Test `packages/cli/test/hypo.test.ts` (or equivalent): `memon hypo show H0003` succeeds; `memon hypo show H3` exits 2 with the expected error code.
- [x] 2.3 Search the rest of the CLI commands for any place that accepts an H/D/R id as input — apply the same `parseId` validation. (`scan`, `show`, `list`, `search`, `journal append --experiment-id` are unaffected because they take experiment dir ids; only commands taking H/D/R ids care.)
- [x] 2.4 Repo-grep `packages/cli/src` for stragglers: `grep -RnE '\b[HDR][0-9]{1,3}\b' packages/cli/src/`.

## 3. Mock data rewrite (in-repo, by hand)

- [x] 3.1 `mock/project-a/HYPOTHESES.md` — table rows + `## H<N>.` headings + body cross-refs all rewritten to padded form. Each `H1`–`H6` becomes `H0001`–`H0006`.
- [x] 3.2 `mock/project-a/JOURNAL.md` — rewrite event-line references.
- [x] 3.3 `mock/project-a/logs/*/README.md` — frontmatter `hypotheses: [...]` arrays + body cross-refs rewritten.
- [x] 3.4 Same treatment for `mock/project-b/`.
- [x] 3.5 Verify: `pnpm --filter @memon/web dev` against `mock/project-a` renders padded IDs in the hypothesis table, frontmatter badges, and URL fragments. No console errors / no parse warnings in the response.

## 4. Web app — anchors, badges, tests

- [x] 4.1 Audit `apps/web/components/**` for any `H${n}` template-literal anchor / id construction; replace with `padId('H', n)` (imported from `@memon/core/ids`) or with the already-padded id from the parsed record (preferred — the parser now hands it over canonical).
- [x] 4.2 Update `apps/web/components/add-event-modal.tsx` placeholder text (`H7` → `H0007`).
- [x] 4.3 `apps/web/lib/agent-prompt.test.ts` + `apps/web/app/api/hypotheses/route.test.ts` + any other test file with literal `'H1'` / `'H3'` etc. — rewrite to padded form.
- [x] 4.4 Live smoke: `pnpm --filter @memon/web typecheck`, `pnpm --filter @memon/web test`, then start dev server, fetch `/p/project-a/hypotheses`, grep returned HTML for `id="H0001"`. Per `CLAUDE.md` F1 — typecheck + 200 OK is NOT enough; verify the served markup.

## 5. Skill files (`packages/skills/memon-*/SKILL.md`)

- [x] 5.1 `memon-run-experiment/SKILL.md` — every README frontmatter example uses padded `hypotheses: [H0003]`; narrative references update. Includes the §1.b allowlist example — no H-id changes there, just verify nothing snuck in.
- [x] 5.2 `memon-write-script/SKILL.md` — example header comments / Composability section: any H references padded.
- [x] 5.3 `memon-append-journal/SKILL.md` — body composition tone examples (`H7 quota thing` etc.) updated.
- [x] 5.4 `memon-digest-journal/SKILL.md` — file naming `D<N>-<YYYY-MM-DD>.md` → `D<NNNN>-<YYYY-MM-DD>.md` everywhere; the `NEXT_N` derivation in §4 changes from `TARGET="docs/digests/D${NEXT_N}-${TODAY}.md"` to `TARGET=$(printf 'docs/digests/D%04d-%s.md' "$NEXT_N" "$TODAY")`. Update the listing-glob comment to match.
- [x] 5.5 `memon-write-report/SKILL.md` — file naming `R<N>-<slug>.md` → `R<NNNN>-<slug>.md`; the next-N derivation pads its output (`printf 'R%04d-%s.md'`).
- [x] 5.6 `memon-propose/SKILL.md` — every brainstorm / proposal example uses padded H-ids; the converged-proposal "Tests: H0003" line shows the padded form.
- [x] 5.7 `packages/skills/README.md` (the INDEX) — any H/D/R example mentions updated.
- [x] 5.8 `pnpm --filter @memon/skills typecheck` (no-op; just confirms nothing TS-side broke).

## 6. In-flight `add-skills-cli` change inline examples

- [x] 6.1 `openspec/changes/add-skills-cli/proposal.md` — any literal H/D/R id examples updated.
- [x] 6.2 `openspec/changes/add-skills-cli/design.md` — same.
- [x] 6.3 `openspec/changes/add-skills-cli/tasks.md` — same. Don't touch task numbering or completion state.
- [x] 6.4 `openspec/changes/add-skills-cli/specs/memon-cli/spec.md` and `specs/experiment-discovery/spec.md` — scenarios mentioning `H3` etc. updated.
- [x] 6.5 `openspec validate add-skills-cli --type change` clean after the rewrites.

## 7. Existing canonical spec scenarios with literal IDs

These are scenario examples in already-archived specs at `openspec/specs/<cap>/spec.md`. Most are touched by the spec deltas in this change, but a few (web-dashboard, agent-handoff, journal, experiment-edit) only have literal-text mentions where requirements aren't changing. Refresh those texts:

- [x] 7.1 `openspec/specs/web-dashboard/spec.md` — find literal `H<n>` (1-3 digits) in scenario text; rewrite to padded form.
- [x] 7.2 `openspec/specs/agent-handoff/spec.md` — same.
- [x] 7.3 `openspec/specs/journal/spec.md` — same.
- [x] 7.4 `openspec/specs/experiment-edit/spec.md` — same.
- [x] 7.5 `CLAUDE.md` at repo root — same treatment for any literal H-id mentions.

## 8. Tests + final lints

- [x] 8.1 `pnpm --filter @memon/core typecheck` clean.
- [x] 8.2 `pnpm --filter @memon/core test` — all green.
- [x] 8.3 `pnpm --filter @memon/cli typecheck` + `test` clean.
- [x] 8.4 `pnpm --filter @memon/web typecheck` + `test` clean.
- [x] 8.5 `openspec validate zero-pad-ids --type change` clean.
- [x] 8.6 Full repo grep — every remaining `\b[HDR]\d{1,3}\b` match must be either: a) a parser-rejection test input (annotated), or b) a comment explaining the regex itself. Anything else is a bug. Command: `grep -RnE '\b[HDR][0-9]{1,3}\b' --include='*.ts' --include='*.tsx' --include='*.md' .`

## 9. Wrap-up

- [x] 9.1 Final live smoke: fresh checkout, `pnpm install`, `pnpm -r build`, `pnpm -r test`, start dev server, render `mock/project-a`, click an `H0001` badge, confirm scroll-to-anchor works.
