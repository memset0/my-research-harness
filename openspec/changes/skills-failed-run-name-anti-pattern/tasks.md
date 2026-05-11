## 1. Add the anti-pattern bullet

- [ ] 1.1 In `packages/skills/memon-run-experiment/SKILL.md`'s `## Anti-patterns` list, add a new bullet (position: after the existing "Setting `FAILED` without leaving a 1-line note in `## Result`." bullet, since that's the closest failure-path-adjacent neighbour):

  ```
  - ❌ Naming a failed run's dir something that doesn't match
    `^.+-\d{6}-\d{6}$` — memon discovery silently skips it, the
    failure record gets dropped.
  ```

## 2. Verification

- [ ] 2.1 `grep -c 'failed run.*dir.*match' packages/skills/memon-run-experiment/SKILL.md` ≥ 1.
- [ ] 2.2 `grep -F '^.+-\d{6}-\d{6}$' packages/skills/memon-run-experiment/SKILL.md` returns ≥ 1 match in the Anti-patterns section.
- [ ] 2.3 `git diff --stat packages/skills/` shows exactly one file modified (`memon-run-experiment/SKILL.md`) with a small insertion count.
- [ ] 2.4 `git diff packages/cli/` is empty.
- [ ] 2.5 `openspec validate skills-failed-run-name-anti-pattern --type change` is clean.
