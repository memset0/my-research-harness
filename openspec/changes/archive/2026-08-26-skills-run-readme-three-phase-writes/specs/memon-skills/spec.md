## ADDED Requirements

### Requirement: `memon-run-experiment` SHALL write the run README in three phases

The skill `packages/skills/memon-run-experiment/SKILL.md` SHALL describe a three-phase model for the run README's lifecycle:

1. **Phase 1 — First write at proof-of-life.** As soon as the launched script (a) emits `[memon] RUN_DIR=...` so the agent knows the run dir path, AND (b) `$RUN_DIR/run.log` exists with non-zero size, the agent SHALL write the first README. The Phase 1 README:
   - SHALL set `status: RUNNING`.
   - SHALL contain complete frontmatter (id, name, experiment, host, command, created_at, updated_at, finished_at, gpus where applicable, wandb where applicable).
   - MAY contain a placeholder body for `## Setup` (e.g. `(pending — full setup written after stable RUNNING)`); the Artifacts list MAY be fully populated since it's path-based, not content-based.
   - The agent SHALL invoke `memon experiment link "$PARENT_EXP_ID" "$RUN_ID"` immediately after the Phase 1 write succeeds (skipped only when the run is intentionally orphan).
2. **Phase 2 — Second update at stable RUNNING.** After the existing `~60s of growing log` stability check confirms the script survived startup, the agent SHALL update the existing README via mtime-locked write to expand `## Setup` with the full env / hardware / hyperparams content, plus any `**Got it running by**:` paragraph from the recovery loop. Status SHALL remain `RUNNING`.
3. **Phase 3 — Subsequent updates during the run, plus terminal-state update.** Periodic checks (the §7 every-~120-min cadence) update `updated_at` and MAY extend `## Setup` if new context emerges. The terminal-state path (success or failure) writes the final status, fills `## Result`, and triggers the exp-doc body routing described by `skills-plan-section-routing`.

The `memon experiment link` invocation SHALL happen at Phase 1. It SHALL NOT be deferred to Phase 2 or terminal — the linkage SHALL be locked while the run is still alive.

The skill body SHALL frame Phase 1 as the dominant path: §10b (FAILED with no prior README) SHALL be described as a rare edge case that fires only when Phase 1's proof-of-life check itself failed (e.g. the script crashed before emitting `[memon] RUN_DIR=...` or produced no log output).

#### Scenario: Skill body names the three phases
- **WHEN** a reader inspects `packages/skills/memon-run-experiment/SKILL.md`
- **THEN** the body explicitly names three phases for the README lifecycle (proof-of-life first write / stable-RUNNING second update / during + terminal updates)
- **AND** the proof-of-life trigger is described as "run dir created AND run.log has content"

#### Scenario: First README write is in §3, not §6
- **WHEN** a reader inspects §3 (Read `[memon] ...` lines) of the skill body
- **THEN** §3's body contains the Phase 1 first-write step (a `memon run readme write ... --expected-mtime 0` invocation, or equivalent first-write semantics)
- **AND** §3 also contains the `memon experiment link "$PARENT_EXP_ID" "$RUN_ID" --project-root .` invocation
- **AND** §6's body is described as an UPDATE (mtime-locked, `--expected-mtime "$MTIME"`) that EXPANDS the existing Phase 1 README, NOT as a first write

#### Scenario: §6 no longer uses `--expected-mtime 0`
- **WHEN** a reader inspects §6 of the skill body
- **THEN** the §6 code example uses `--expected-mtime "$MTIME"` (the captured mtime from Phase 1), NOT `--expected-mtime 0`
- **AND** §6's preamble does NOT contain the legacy "Only after §5 confirms the run is alive. This ordering is deliberate: writing a RUNNING README before the script proves it can survive..." paragraph (replaced by Phase 2 language)

#### Scenario: §10b is framed as the rare edge case
- **WHEN** a reader inspects §10b (FAILED with no prior README)
- **THEN** §10b's preamble explicitly states it is a rare path that fires only when Phase 1's proof-of-life check did not fire (e.g. no `[memon] RUN_DIR=...` echoed or run.log never gained content)

#### Scenario: Anti-patterns forbid skipping Phase 1
- **WHEN** a reader inspects the Anti-patterns section
- **THEN** at least one bullet forbids skipping the Phase 1 first write (running a script without producing a README + exp link as soon as proof-of-life is established)
- **AND** at least one bullet forbids deferring `memon experiment link` past Phase 1 (e.g. waiting until terminal state)
