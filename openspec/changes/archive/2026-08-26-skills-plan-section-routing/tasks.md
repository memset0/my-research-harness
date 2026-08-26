## 1. `memon-run-experiment/SKILL.md`

- [ ] 1.1 In §0 (Identify or create the parent experiment doc), in the "No existing experiment fits → propose creating a new one" branch, after the existing `memon experiment create` block, add a paragraph stating: when discussing initial body content with the user, ask about `## Plan` alongside `Motivation` / `Method`. If the user has forward-looking ideas, those become initial `- [ ]` task items in `## Plan` — NOT bullets in `## Method`.
- [ ] 1.2 In §9 (Terminal — success path), rewrite the "用中文 walk through" bullet list. Current 5 bullets:
  - 改动了什么(对应 `**Got it running by**:`,如果有,在这个 run 的 Setup 里)
  - 主要结果是什么(对应 run 的 `## Result`)
  - 结论是什么 / 怎么影响关联的假说(对应 exp doc 的 `## Conclusion` 更新)
  - 实现思路 / 设计 rationale(对应 exp doc 的 `## Method` 追加)
  - 让用户注意的细节 / 解读限制(对应 exp doc 的 `## Caveats` 追加)

  Replace the third bullet with:
  - 这一 run 学到了什么 → 如果是跨 run 已经能下的结论(同方向证据 ≥2 run),写进 exp doc 的 `## Conclusion`;否则放进对应 `## Plan` task 下面作为反思 sub-bullet,等多 run 攒够再 promote
  - 对应的 Plan task 如果做完了,把 `- [ ]` 改成 `- [x]`(就改这一条,不动其他)
- [ ] 1.3 In §9, rewrite the "Every cross-run insight has a deterministic home" closing paragraph. New version:

  ```
  Every cross-run insight has a deterministic home:

  - **Reproducible mechanical changes that made the run launch** → this run's
    `## Setup` (`**Got it running by**:` paragraph).
  - **Per-run observation, not yet a defensible cross-run pattern** → a
    reflection sub-bullet under the relevant `## Plan` task on the exp doc.
  - **Defensible cross-run conclusion** (consistent evidence from ≥2 runs)
    → exp doc's `## Conclusion`.
  - **Methodology refinement that applies across the experiment** → exp
    doc's `## Method`.
  - **Cross-run interpretation limit** → exp doc's `## Caveats`.
  - **Anomaly the human should adjudicate** → exp doc's `## Warnings`
    (via §12's post-run review).
  - **Cross-cutting observation that doesn't belong to any single
    experiment** → `docs/journal.md` as a `[NOTE]` event (e.g. "memory
    leaks above 32B context on this box" — applies project-wide).

  Plan is the default for per-run learnings; journal-NOTE is the fallback
  for the genuinely cross-experiment case.
  ```
- [ ] 1.4 In §9, add a new sub-section after the Chinese walkthrough titled `#### Consider FINISHED?` that lists the three signals (all `[x]` in Plan / every member run terminal / non-empty Conclusion) and instructs the agent to surface to the user "this exp looks ready to mark FINISHED — flip its status?" when all three hold. The body MUST explicitly say this is a *signal*, not an auto-promote, and the actual transition still requires the user's `yes`.
- [ ] 1.5 In §12 (Post-run anomaly review), add one short paragraph near the top distinguishing Plan reflections (per-run learnings that feed Conclusion eventually) from Warnings (anomalies needing human adjudication). They are different surfaces; this skill writes Warnings here; per-run reflections go to Plan via §9.

## 2. `memon-write-script/SKILL.md`

- [ ] 2.1 In the "Identify the parent experiment" → Branch 2 section (where the user agrees to create a new exp doc), in step 1 ("Discuss initial Motivation / Method content with the user"), add a sub-bullet: **if the user mentions forward-looking ideas like "next try X / Y / Z", those go in `## Plan` as `- [ ]` items, not in `## Method`**. Method describes methodology only.
- [ ] 2.2 In the "When you're done — Register the script with its parent experiment" section, confirm the script registry line stays in `## Method` (script registration is part of methodology). Add a clarifying sentence: this `- \`scripts/foo/run.sh\` — …` bullet IS methodology (it names what the experiment's reproducible setup includes), so it belongs in `## Method`, not `## Plan`.

## 3. `memon-propose/SKILL.md`

- [ ] 3.1 In §1 (Snapshot the project), extend the list of inputs the skill reads. After the existing snapshot + digests + reports reads, add a fourth read for relevant exp docs' `## Plan` sections:

  ```sh
  # Read the Plan section of each exp doc the snapshot surfaced.
  for exp in $(echo "$SNAPSHOT" | jq -r '.experiments.entries[].id'); do
    memon experiment show "$exp" --project-root . --format json \
      | jq -r '.sections.plan // empty'
  done
  ```

- [ ] 3.2 In §4 (Diverge — 5-8 candidates), add an instruction near the top: **before proposing candidates, list any already-`[ ]`-listed Plan items across the relevant exps as "already-planned, can be resumed by the user"**. These are strong priors and SHOULD NOT be re-proposed as net-new candidates unless the brainstorm is consciously suggesting an alternative.
- [ ] 3.3 In §5 (Converge — 1-3 strongest), the "Why this over the brainstorm alternatives" pattern stays. Add: if a converged proposal overlaps with an already-`[ ]` Plan item, name that explicitly ("Plan item E0001-foo § \"sweep bs\" — this proposal extends it by …") rather than presenting it as net-new.

## 4. Verification

- [ ] 4.1 `grep -nE 'Plan' packages/skills/memon-run-experiment/SKILL.md` lists multiple matches in §0, §9, §12.
- [ ] 4.2 `grep -nE 'Plan' packages/skills/memon-write-script/SKILL.md` includes a match near the Branch 2 area.
- [ ] 4.3 `grep -nE 'Plan' packages/skills/memon-propose/SKILL.md` includes matches in §1 (snapshot) and §4/§5.
- [ ] 4.4 The §9 deterministic-home paragraph names `## Plan` as the default home for per-run insights; `docs/journal.md` `[NOTE]` is described as a cross-cutting fallback, not the default.
- [ ] 4.5 `openspec validate skills-plan-section-routing --type change` is clean.
- [ ] 4.6 `git diff packages/cli/` is empty (no runtime changes).
- [ ] 4.7 `git diff packages/skills/memon-digest-journal/SKILL.md packages/skills/memon-write-report/SKILL.md packages/skills/memon-append-journal/SKILL.md packages/skills/memon-append-warning/SKILL.md packages/skills/memon-migrate-fs/SKILL.md` is empty (these 5 skills are not modified).
