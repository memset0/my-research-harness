## 1. Expand §3 to include Phase 1

- [ ] 1.1 At the end of §3 (Read `[memon] ...` lines from the script's output), AFTER the existing "If a script does NOT emit these lines..." paragraph, ADD a new sub-section `#### Proof-of-life check` describing the bar: `$RUN_DIR` known + `$RUN_DIR/run.log` exists with non-zero size, with a short retry window (poll up to 5s in 1s steps) to handle the case where the `[memon]` echo flushed before the tee write. If still empty after the wait, do NOT proceed to Phase 1; flag to user and treat as §3 fallback (handoff to user/write-script).
- [ ] 1.2 After the proof-of-life sub-section, ADD `#### Phase 1 — First README write (minimal) + `memon experiment link``. Include:
  - The `memon run readme write "$RUN_ID" --project-root . --expected-mtime 0` invocation with the minimal README body (frontmatter complete; `## Setup` is a placeholder `(pending — full setup written after stable RUNNING)`; `## Result` is `(pending)`; `## Artifacts` lists the expected paths even though `code.diff` hasn't been deposited yet — that's §4's job).
  - Capture the new `mtime` as `$MTIME`.
  - Immediately follow with `memon experiment link "$PARENT_EXP_ID" "$RUN_ID" --project-root .` (skip when orphan-by-choice).

## 2. Adjust §4 preamble

- [ ] 2.1 In §4 (Drop in code snapshots), REPLACE the existing preamble paragraph "The script only `mkdir`s `$RUN_DIR` and tees `run.log`. It does NOT write `README.md` — that's this skill's job, and it happens AFTER the stable check (§6), not now." with a paragraph that reflects the new ordering: the Phase 1 README has already been written in §3; §4's job is to deposit the snapshots so the `## Artifacts` list's claims are backed by files on disk before §6 expands the Setup body.

## 3. Reframe §5

- [ ] 3.1 In §5 (Wait for stable RUNNING), update the trailing branch "If the script returned non-zero in sync mode (or the tmux session already exited), skip to §10 (Failed path) — and do NOT write a RUNNING README; the failure path will write a FAILED README from scratch." — this is now wrong (the README already exists from Phase 1). Replace with: "skip to §10a (the existing-README failure path); flip status to FAILED via mtime-locked update".

## 4. Rewrite §6 as Phase 2 expansion

- [ ] 4.1 Rename §6 from `### 6. Write the README (status: RUNNING)` to `### 6. Phase 2 — Expand the README after stable RUNNING`.
- [ ] 4.2 Replace §6's preamble ("Only after §5 confirms the run is alive. This ordering is deliberate: writing a RUNNING README before the script proves it can survive the first 60 seconds means orphan READMEs claiming to be RUNNING for processes that already died.") with: a one-paragraph explanation that §3 already wrote the Phase 1 README, §5 just confirmed stability, and §6's job is to expand `## Setup` (full env / hardware / hyperparams / Got-it-running-by) via mtime-locked update.
- [ ] 4.3 In the code example, change `--expected-mtime 0` (the first-write sentinel) to `--expected-mtime "$MTIME"` (the captured mtime from §3's Phase 1 write).
- [ ] 4.4 Remove the now-redundant "Then bind the run to its parent experiment" block (the `memon experiment link` invocation moved to §3 as part of Phase 1). Keep the schema reminders paragraph (still relevant).

## 5. Update §0 cross-references

- [ ] 5.1 In §0, update the sentence "binding can land atomically right after the README is written in §6" → "binding lands atomically at Phase 1 in §3, right after the proof-of-life first write".
- [ ] 5.2 In §0, update "while writing the run's README in §6 the agent also writes Motivation/Method into the exp doc on the user's behalf" → "while doing the Phase 2 expansion in §6 the agent also writes Motivation/Method into the exp doc on the user's behalf".
- [ ] 5.3 In §0, update "skip the link step in §6" → "skip the link step in §3 (Phase 1)".
- [ ] 5.4 In §0, update "in §6 after the run README is written. The atomicity guarantee comes from running `memon experiment link` once both files exist — see §6." → "in §3 at Phase 1, when the first README + link both fire. See §3."

## 6. Reframe §10b as the rare edge

- [ ] 6.1 In §10 (Terminal — failure path), update the branching preamble "Branch on **whether §6 already wrote a README**: ..." to reflect the new asymmetry: §10a (README exists from Phase 1) is the dominant path; §10b only fires when Phase 1 itself didn't fire (rare edge — script crashed before `[memon] RUN_DIR=...` echoed or run.log produced no content).
- [ ] 6.2 In §10b, replace the existing preamble with: "Rare edge case: Phase 1 from §3 did not fire (the script crashed before emitting `[memon] RUN_DIR=...`, or produced no log output within the proof-of-life wait window). The agent must construct a regex-conforming run dir manually (per the `^.+-\d{6}-\d{6}$` rule), then write a FAILED README from scratch."
- [ ] 6.3 The existing §10b code example for writing a FAILED README from scratch stays — but its preamble is now the rare-edge framing above. The `memon experiment link` invocation at the bottom of §10b stays (it locks the linkage even in the rare-edge case).

## 7. Anti-patterns

- [ ] 7.1 Add a bullet under `## Anti-patterns`: `❌ Skipping the Phase 1 first README write at §3 — a run dir on disk without a README and without \`memon experiment link\` is how runs get lost (not in discovery via README; not in the parent exp's \`runs[]\` either). Phase 1 is the linkage; do it as soon as the script reaches proof-of-life.`
- [ ] 7.2 Add a bullet under `## Anti-patterns`: `❌ Calling \`memon experiment link\` only at terminal state. The link must fire at Phase 1 — locking the run ↔ exp binding while the run is still alive is the whole point of writing the README early.`

## 8. Verification

- [ ] 8.1 `grep -nE 'proof.?of.?life' packages/skills/memon-run-experiment/SKILL.md` returns ≥ 1 match in or near §3.
- [ ] 8.2 `grep -nE 'Phase 1|Phase 2|Phase 3' packages/skills/memon-run-experiment/SKILL.md` returns multiple matches.
- [ ] 8.3 `grep -nE 'memon experiment link' packages/skills/memon-run-experiment/SKILL.md` shows the call inside §3 (not §6).
- [ ] 8.4 §6 heading: `grep -nE '^### 6\.' packages/skills/memon-run-experiment/SKILL.md` shows "Expand" or "Phase 2" in the title.
- [ ] 8.5 §6 code example uses `--expected-mtime "$MTIME"` (not `--expected-mtime 0`): `awk '/^### 6\./{f=1; next} f && /^### /{exit} f' packages/skills/memon-run-experiment/SKILL.md | grep 'expected-mtime'` shows `$MTIME`, not `0`.
- [ ] 8.6 §10b preamble mentions "rare edge" / "Phase 1 ... did not fire" or equivalent: `awk '/#### 10b/{f=1; next} f && /^#### /{exit} f' packages/skills/memon-run-experiment/SKILL.md | head -5`.
- [ ] 8.7 Anti-patterns gains ≥ 2 new bullets (search for "Phase 1" or "proof-of-life" in the section).
- [ ] 8.8 `git diff packages/cli/` is empty.
- [ ] 8.9 `git diff --stat packages/skills/` shows exactly one file modified (`memon-run-experiment/SKILL.md`).
- [ ] 8.10 `openspec validate skills-run-readme-three-phase-writes --type change` is clean.
