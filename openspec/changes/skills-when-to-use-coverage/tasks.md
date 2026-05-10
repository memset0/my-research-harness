## 1. Add When-to-use / When-NOT-to-use sections to 5 skills

For each of the 5 skills, insert two sections immediately after the preflight pointer (i.e. between the closing line `... (covers \`match\` / \`behind\` / \`uninitialised\` / \`ahead\`).` + blank, and the next `## ` heading).

### 1.1 `memon-write-script`

Between preflight pointer and `## Identify the parent experiment`. Bullet text:

```
## When to use

- The user asks you to write a new launcher script (e.g. "write a script for the zero-SNR sweep")
- You're orchestrating a new experiment that has no launcher yet
- An existing script needs a variant or wrapper for a sweep (`run_bs16.sh` next to `run.sh`)
- The user asks for a script that follows the project's run-dir + log conventions

## When NOT to use

- ❌ The user just wants to run an existing script — that's `memon-run-experiment`'s job
- ❌ For ad-hoc one-line shell or tmux commands — write those directly
- ❌ When the script's purpose isn't launching an experiment (data preprocessing without a run dir, deployment scripts) — out of scope
- ❌ For Python entry points or library code — this skill is shell-script-only
```

- [ ] 1.1 Insert in `packages/skills/memon-write-script/SKILL.md`.

### 1.2 `memon-run-experiment`

Between preflight pointer and `## Prerequisite — read \`CLAUDE.md\` first`. Bullet text:

```
## When to use

- The user asks you to run an existing launcher script and own the run's README lifecycle
- A sweep needs to fire across multiple env-var configurations of an existing script
- A previous run failed and the user asks you to retry / resume / iterate-and-fix
- The user pointed at a specific run dir and wants you to keep going (resume case)
- The user described an experiment but wants you to drive both authoring AND running (delegate to `memon-write-script` first, then come back)

## When NOT to use

- ❌ The user wants to write a new script with no intent to run it now — handoff to `memon-write-script` only
- ❌ For ad-hoc shell commands that don't produce a structured run dir — run them directly
- ❌ For aggregate analysis across multiple existing runs — that's `memon-write-report` or `memon-digest-journal`
- ❌ For one-off "just record this observation" with no actual training — `memon-append-journal --tag NOTE`
```

- [ ] 1.2 Insert in `packages/skills/memon-run-experiment/SKILL.md`.

### 1.3 `memon-digest-journal`

Between preflight pointer and `## File naming`. Bullet text:

```
## When to use

- It's been days / a sprint since the last digest, and the user wants the periodic sweep + cursor advance
- The integrity sweep (formerly `memon-doctor`) needs to run alongside — there is no separate doctor skill
- The user asks "what happened recently?" without a specific theme
- A pre-meeting / pre-review status snapshot is wanted

## When NOT to use

- ❌ Theme-driven narrative ("everything about H0007") — that's `memon-write-report`
- ❌ Just appending one event to the journal — that's `memon-append-journal`
- ❌ For status changes on an experiment — `memon experiment status set` directly
- ❌ When the user explicitly wants to skip the integrity sweep — there's no opt-out; this skill folds doctor in
```

- [ ] 1.3 Insert in `packages/skills/memon-digest-journal/SKILL.md`.

### 1.4 `memon-write-report`

Between preflight pointer and `## File naming`. Bullet text:

```
## When to use

- The user wants a theme-driven write-up that is NOT cursor-bound (e.g. "everything I learned about H0007 across the past 3 weeks")
- An existing report (`R<NNNN>-<slug>.md`) needs updating with new evidence
- The narrative should survive across digest boundaries (overlapping or disjoint windows)
- The user wants a re-runnable selector embedded in the artifact so future updates know what to look for

## When NOT to use

- ❌ Periodic / cursor-advancing summaries — that's `memon-digest-journal`
- ❌ A single observation that doesn't deserve a multi-paragraph artifact — `memon-append-journal --tag NOTE`
- ❌ For run-specific READMEs — those are owned by `memon-run-experiment`
- ❌ Hypothesis-status updates — edit `docs/hypotheses.md` directly, no report needed
```

- [ ] 1.4 Insert in `packages/skills/memon-write-report/SKILL.md`.

### 1.5 `memon-propose`

Between preflight pointer and `## Why brainstorm at all`. Bullet text:

```
## When to use

- The user asks "what should I run next?"
- A hypothesis is `OPEN` or `PARTIAL` and the user wants candidate probes
- The user is between experiments and wants a menu of options to react against
- A recent FAILED run hints at adjacent experiments worth running
- The user wants explicit alternatives considered + rejected, not just one recommendation

## When NOT to use

- ❌ The user already named a specific experiment to run — go straight to `memon-write-script` / `memon-run-experiment`
- ❌ For implementation help on a known direction — this skill is read-only brainstorm
- ❌ For analyzing an in-flight experiment — those are still RUNNING; check via `memon show` instead
- ❌ When the project has zero hypotheses yet — talk with the user about hypothesis seeding first
```

- [ ] 1.5 Insert in `packages/skills/memon-propose/SKILL.md`.

## 2. Update README matrix

- [ ] 2.1 Add a new row at the bottom of the "Pick the right skill for the job" matrix in `packages/skills/README.md`:

  ```
  | Migrate a project's on-disk layout to a newer FS convention version | `memon-migrate-fs` | User-invoked. Only skill that bumps `.memon/version.json`. Exempt from the FS-version preflight. |
  ```

## 3. Verification

- [ ] 3.1 `grep -l '^## When to use$' packages/skills/memon-*/SKILL.md | wc -l` — output `8`.
- [ ] 3.2 `grep -l '^## When NOT to use$' packages/skills/memon-*/SKILL.md | wc -l` — output `8`.
- [ ] 3.3 For each of the 8 SKILL.md files, count bullets in `## When to use` and `## When NOT to use`. Each section's bullet count is in the inclusive range [3, 6]. The 5 newly-added sections target 4–5; the 3 existing sections sit at 3–4.
- [ ] 3.4 Inspect `packages/skills/README.md`'s matrix: should have 8 data rows; the new `memon-migrate-fs` row is present.
- [ ] 3.5 `openspec validate skills-when-to-use-coverage --type change` — clean.
- [ ] 3.6 `git diff packages/cli/` is empty (no runtime changes).
- [ ] 3.7 `git diff packages/skills/memon-migrate-fs/SKILL.md` is empty (its existing sections were not modified).
