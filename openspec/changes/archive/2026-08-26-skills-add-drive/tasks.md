## 1. Author `packages/skills/memon-drive/SKILL.md`

- [ ] 1.1 Create the file with frontmatter: `name: memon-drive`, `description: <≤30-word summary>`, `argument-hint: <experiment idea, or existing E-id to continue>`, `license: MIT`, `metadata: { author: memset0, version: "0.1.0" }`. Do NOT include `disable-model-invocation: true`.
- [ ] 1.2 `# memon-drive` H1 + 2-paragraph intro explaining the orchestrator role: long-running conversational session for one experiment; primary canvas is the exp doc's `## Plan`; calls `memon-write-script` / `memon-run-experiment` as sub-tools; transcribes conversation back to exp doc.
- [ ] 1.3 `## Preflight — FS convention version` section — byte-equal to the pointer used by the other 7 spec-mutating skills (verify with md5sum vs an existing one after writing).
- [ ] 1.4 `## When to use` (4–5 bullets covering: user proposes new exp; user asks to resume existing exp; vague idea that needs design iteration; mid-experiment direction change).
- [ ] 1.5 `## When NOT to use` (4–5 `❌` bullets covering: single concrete run with known script → memon-run-experiment; cross-project brainstorming → memon-propose; writing a launcher with no exp context → memon-write-script; single observation → memon-append-journal / memon-append-warning).
- [ ] 1.6 `## Two entry modes` section: Mode A (start fresh) and Mode B (resume), each with a numbered checklist.
- [ ] 1.7 `## Workflow` section with 6 numbered steps:
  - §0 Discover or create the exp doc.
  - §1 Iterate design with the user until next step is concrete (three pre-action gates).
  - §2 Execute Plan items — sub-sections 2a (new launcher → write-script), 2b (existing launcher → run-experiment), 2c (inline analysis utility, NOT write-script). 2c includes the decision rule.
  - §3 Update the exp doc after each Plan item.
  - §4 Continuously transcribe conversation into the exp doc; "unsure → ask the user (in Chinese)" guidance with literal Chinese prompt example.
  - §5 Consider FINISHED — three-signal check; surface to user; SHALL NOT auto-transition.
- [ ] 1.8 `## Distinguishing launcher scripts from analysis utilities` section: 1-paragraph intro + comparison table (Output / Lifecycle / GPU / Wall time / `[memon]` echo / README ownership / Method registration / Reproducibility test) + decision rule sentence.
- [ ] 1.9 `## Section-routing reference` table: "User says / agent observes" → "Section". Includes Motivation, Method, Script registration, Plan task, Plan reflection, Conclusion, Caveats, Warnings, journal NOTE. Bottom: literal Chinese question for the "unsure" case.
- [ ] 1.10 `## Anti-patterns` section with 6–8 ❌ bullets.

## 2. Registry + README updates

- [ ] 2.1 Edit `packages/skills/src/index.ts`: add `'memon-drive'` as the FIRST entry of `SKILL_NAMES` (drive is the umbrella orchestrator / entry point). Total entries: 9.
- [ ] 2.2 In `packages/skills/README.md`'s "Pick the right skill for the job" matrix, add a new row at the top (above `memon-write-script`):
  ```
  | Drive one experiment end-to-end via conversation (design → write-script → run-experiment → maintain exp doc) | `memon-drive` | Long-running orchestrator. Calls write-script / run-experiment as sub-tools. Primary canvas: exp doc's `## Plan`. |
  ```
  Matrix goes from 8 to 9 rows.
- [ ] 2.3 In `packages/skills/README.md`'s "Cross-skill handoffs" section, add a paragraph above the existing ASCII pipeline diagram explaining `memon-drive` as an umbrella orchestrator that calls `memon-write-script` and `memon-run-experiment` as sub-tools. Suggested wording: "`memon-drive` (the new orchestrator) sits above this pipeline — it owns the conversation with the user and the exp doc's `## Plan`, and fires `memon-write-script` / `memon-run-experiment` on demand as it iterates through Plan items."
- [ ] 2.4 In `packages/skills/README.md`'s "Files written / never written, by skill" table, add a row for `memon-drive`:
  ```
  | `memon-drive` | exp doc body sections (Motivation/Method/Plan/Conclusion/Caveats) via `memon experiment readme write` | run READMEs (sub-skills own those), scripts (write-script owns), digests, reports, JOURNAL cursor, warning state changes |
  ```

## 3. Build + smoke test

- [ ] 3.1 `pnpm --filter @memon/skills build` — clean (compiles src/index.ts → dist/).
- [ ] 3.2 Build verify: `SKILL_NAMES` length is 9, `'memon-drive'` is included.
- [ ] 3.3 Smoke install: `pnpm --filter @memon/cli build && node packages/cli/dist/index.js install-skills --project-root /tmp/drive-smoke --agent claude --format json | jq -r '.targets[0].installed[]' | sort` — output includes `memon-drive`.
- [ ] 3.4 `diff /tmp/drive-smoke/.claude/skills/memon-drive/SKILL.md packages/skills/memon-drive/SKILL.md` — byte-equal.
- [ ] 3.5 `pnpm --filter @memon/cli test` — all install-skills tests still green (no test changes needed since they use a fake source dir).
- [ ] 3.6 `openspec validate skills-add-drive --type change` — clean.

## 4. Section-content sanity checks

- [ ] 4.1 `grep -c '^## ' packages/skills/memon-drive/SKILL.md` — at least 8 top-level sections.
- [ ] 4.2 `awk '/^## Preflight/{f=1; print; next} f && /^## /{exit} f' packages/skills/memon-drive/SKILL.md | md5sum` matches the same extraction from `memon-write-script/SKILL.md` (the canonical preflight pointer is byte-equal across all 8 spec-mutating skills including the new one).
- [ ] 4.3 `grep -c '^- ' packages/skills/memon-drive/SKILL.md` for the When-to-use + When-NOT-to-use sections: each within [3, 6] bullets (per the convention from `skills-when-to-use-coverage`).
- [ ] 4.4 The body explicitly mentions both `memon-write-script` and `memon-run-experiment` as sub-tools (`grep -c 'memon-write-script\|memon-run-experiment' packages/skills/memon-drive/SKILL.md` ≥ 2 each).
- [ ] 4.5 The body contains the literal "(in Chinese):" lead-in for any embedded Chinese blockquote (per `skills-chinese-dialogue-convention`).
