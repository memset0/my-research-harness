## Why

The current `memon-run-experiment` workflow defers the first README write until §6, which fires only after §5 confirms ~60 seconds of stable RUNNING. The intent was "don't create orphan READMEs claiming RUNNING for processes that died". In practice this creates two failure modes:

1. **Bound-to-exp linkage is lost on early crashes.** If the script creates `RUN_DIR`, starts producing log output, then crashes inside the 60s window, the run dir exists on disk but no README has been written and no `memon experiment link` has fired. The run is bound to nothing; the parent exp's `runs[]` doesn't know about this attempt. The agent may then write a FAILED README later (§10b), but agent crash or distraction between §3 and §10b is enough to lose the linkage permanently.
2. **Failed runs become invisible.** Combined with the failed-run-naming concern, a script that crashes early can end up with a run dir whose existence is forgotten because no README was ever written and no exp link ever fired.

The user's directive: **as soon as the script reaches proof-of-life (run dir created AND `run.log` has any output), do the first README write + `memon experiment link`. Don't wait for stable RUNNING.** Stable RUNNING is then a *second* update (expanding the body with full Setup content). Subsequent updates fire during the run and at terminal state.

## What Changes

Restructure `memon-run-experiment/SKILL.md` to a **three-phase README write model**:

- **Phase 1 — First write (proof-of-life)**: as soon as §3 reads `[memon] RUN_DIR=...` AND `run.log` exists with non-zero size, write a minimal README (`status: RUNNING`, frontmatter complete, body has `## Setup\n(pending — full setup written after stable RUNNING)` placeholder + Artifacts list) AND immediately run `memon experiment link`. This locks the run ↔ exp linkage and ensures discovery sees the run.
- **Phase 2 — Second update (stable RUNNING confirmed)**: after §5 confirms ~60s of growing log, UPDATE the existing README (mtime-locked) to expand `## Setup` with the full env / hardware / hyperparams / Got-it-running-by content. Status stays `RUNNING`.
- **Phase 3 — Subsequent updates (during run + terminal)**: §7 periodic checks update `updated_at` and may extend `## Setup` if new context emerges. §9 (success) and §10 (failure) update to terminal state + Result, plus exp doc Conclusion/Caveats/Method/Plan per the routing rules from `skills-plan-section-routing`.

Concretely:

- **§3** (Read `[memon] ...` lines): keep current content; append two new sub-sections:
  - "Proof-of-life check" — verify `run.log` exists and has content (with a short retry window if empty);
  - "First README write — minimal, with `memon experiment link`" — the Phase 1 write.
- **§4** (Drop in code snapshots): update preamble — the "it does NOT write README ... happens AFTER the stable check (§6)" claim becomes false. New preamble explains snapshots are deposited AFTER the §3 first README write, BEFORE the §6 expansion.
- **§5** (Wait for stable RUNNING): keep the 60s growth check. Update its failure branch — "if non-zero in sync mode or tmux exited, skip to §10" — since README already exists from §3, §10 always lands on §10a (the existing-README path).
- **§6** (Write the README → renamed to "Expand the README — second update after stable RUNNING"): replace the first-write semantics with mtime-locked UPDATE. The README body's `## Setup` placeholder gets replaced with full content; status stays RUNNING.
- **§0** (Identify or create parent exp): the cross-references that say "binding happens in §6" or "writing the README in §6" become "in §3 (first write) and may be updated in §6 (expansion)". Specifically the `memon experiment link` step moves from §6 to §3.
- **§10** (failure path): §10a remains the dominant path (README always exists after Phase 1). §10b shrinks to a rare-edge-case note for "script crashed BEFORE Phase 1 could fire (no `[memon] RUN_DIR=...` echoed OR no run.log output)".
- **Anti-patterns**: add two bullets:
  - ❌ Skipping the Phase 1 first write at proof-of-life — leaving a run dir on disk without a README and without a `memon experiment link` is how runs get lost.
  - ❌ Calling `memon experiment link` AFTER the run reaches terminal state instead of at Phase 1 — locking the linkage early is the whole point.

The `Run README schema reminders` paragraph stays in §6 (still relevant — the schema doesn't change between phases).

Out of scope:
- Changing the JSON shape of `memon run readme write` or any CLI behaviour.
- Touching `memon-write-script` (Phase 1's run-dir + log existence depends on what write-script's launcher does, but that's already specified — `mkdir -p` + `tee -a`).
- Touching `memon-drive` — it delegates run lifecycle to `memon-run-experiment`; the three-phase model applies inside that delegation.
- Renumbering the §-section index. Cross-refs already point at §3/§6/§9/§10/§11/§12 etc.; keeping the numbering avoids ~57 cross-reference rewrites.

Acceptance gate (verifiable):
- `grep -nE 'proof.?of.?life' packages/skills/memon-run-experiment/SKILL.md` returns ≥ 1 match in §3.
- §3 contains a `memon experiment link` invocation (moved from §6).
- §6's heading uses the word "Expand" or "Second update" instead of "Write the README".
- §6 contains a `--expected-mtime "$MTIME"` line (it's an update, not a first write — no `--expected-mtime 0`).
- §10b's preamble mentions "Phase 1 didn't fire" or equivalent (rare edge case framing).
- Anti-patterns contains two new bullets about Phase 1 + early link.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memon-skills`: MODIFY the existing run-README-write requirement to enforce the three-phase model: first write at proof-of-life (run dir + run.log content), second update at stable RUNNING (expand Setup), subsequent updates during + at terminal state. The `memon experiment link` call moves from after-stable to at-proof-of-life.

## Impact

- **Code**: none.
- **Docs / skill bodies**: 1 SKILL.md (`memon-run-experiment`). Net change: ~50 lines added across §3 + Anti-patterns; ~10 lines edited in §0 / §4 / §5 / §6 / §10 to reflect the new flow.
- **Specs**: delta on `memon-skills` (MODIFY).
- **No runtime changes**.
- **Migration risk**: agents reading the new skill body will write the linkage README earlier. Existing runs already on disk (pre-change) are unaffected — they were either properly linked or stuck under the old behaviour; the new flow doesn't try to repair history.
