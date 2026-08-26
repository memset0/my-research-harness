## 1. Fixes in `memon-write-script/SKILL.md`

- [ ] 1.1 Update the `**ask the user**:` lead-in (in the "How to pick the right env name" section, around line 287) to `**ask the user** (in Chinese):`.
- [ ] 1.2 In the same section, remove the `"..."` quotes wrapping the two blockquote lines that follow (the `>` is already the quoting device).
- [ ] 1.3 Update the `just offer:` lead-in (in the smoke-test confirmation section, around line 533) to `just offer (in Chinese):`.

## 2. Fixes in `memon-run-experiment/SKILL.md`

- [ ] 2.1 Update the `In Chinese:` lead-in (around line 115, in §0 Identify the parent experiment) to `(in Chinese):` for consistency with the canonical form.
- [ ] 2.2 Fix the typo on the `>能走完整的` line (around line 946, in the "Migration helpers (legacy projects only)" section) — add a space after `>` so it becomes `> 能走完整的`.

## 3. Fixes in `memon-migrate-fs/SKILL.md`

- [ ] 3.1 Update the lead-in `Embed the prompt as user-facing dialogue (Chinese):` (around line 83) to `Embed the prompt as user-facing dialogue (in Chinese):`.
- [ ] 3.2 Insert a single prose line `Tell the user (in Chinese):` immediately before the `> 迁移完成。…` blockquote (around line 187, in §6 Final report).

## 4. Verification

- [ ] 4.1 `grep -E '\(Chinese\):' packages/skills/memon-*/SKILL.md` — output is empty.
- [ ] 4.2 `grep -E '^In Chinese:|[^a-z]In Chinese:' packages/skills/memon-*/SKILL.md` — output is empty.
- [ ] 4.3 `grep -nE '^>[^[:space:]]' packages/skills/memon-*/SKILL.md` — output is empty (every `>` line in a blockquote starts with a space or is empty).
- [ ] 4.4 Confirm `memon-append-warning/SKILL.md` was not modified: `git diff packages/skills/memon-append-warning/SKILL.md` is empty.
- [ ] 4.5 Confirm the 4 skills with no inline Chinese dialogue (`memon-append-journal`, `memon-digest-journal`, `memon-write-report`, `memon-propose`) were not modified.
- [ ] 4.6 `git diff packages/cli/` is empty (no runtime changes).
- [ ] 4.7 `openspec validate skills-chinese-dialogue-convention --type change` — clean.
