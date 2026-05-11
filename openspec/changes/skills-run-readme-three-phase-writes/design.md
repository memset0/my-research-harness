## Context

Today's flow in `memon-run-experiment` is sequential and conservative:

1. §1 Pre-launch (env + GPU check, code.diff capture).
2. §2 Launch (sync or tmux).
3. §3 Read `[memon] PROJECT_ROOT / RUN_NAME / RUN_DIR` lines from the script's output.
4. §4 Drop `code.diff` / `code.head` into the run dir.
5. §5 Wait ~60 seconds of growing log to confirm "stable RUNNING".
6. §6 Write README with `status: RUNNING` + full body. THEN run `memon experiment link`.
7. §7+ Periodic checks; eventual terminal state writes (§9 success, §10 failure).

The §5→§6 gate was added to avoid "orphan README claiming RUNNING for a process that already died". In practice this means run dirs on disk between §3 and §6 (a 60+-second window) carry no README and no `experiment.runs[]` entry. If the agent crashes or gets distracted in that window, the run is lost from the user's view.

The user's directive: move the first README write + exp link to the earliest possible point that we have actionable information (run dir created + log producing output), accept the trade-off that a status-RUNNING README may briefly outlive its process if the agent fails to follow through (the digest doctor pass already catches stale RUNNING). Stable RUNNING becomes the trigger for a *second* update that expands body content, not for first existence.

## Goals / Non-Goals

**Goals:**
- README and `memon experiment link` fire as soon as proof-of-life is established (run dir + log has content). This is Phase 1.
- After §5 confirms stable RUNNING, the existing README is UPDATED (mtime-locked) to expand `## Setup` and (if applicable) `Got it running by`. This is Phase 2.
- Subsequent updates during the run + at terminal state continue as today. Phase 3.
- §0's cross-references that pointed at §6 for "where the link happens" now point at §3.
- The §-section index stays at 0/1/.../12 to avoid the 57-cross-reference renumbering churn.
- Anti-patterns explicitly forbid the failure mode (no Phase 1 write, or link deferred to after-terminal).

**Non-Goals:**
- Changing run-README schema, CLI behavior, or JSON shape.
- Changing what `memon-write-script` emits (proof-of-life depends on `mkdir -p RUN_DIR` and `tee -a run.log`, both already mandated by Convention #5 / #8 in write-script).
- Adding a new `PENDING` or intermediate status. Phase 1 writes `status: RUNNING` — the trade-off is that a brief RUNNING-but-dead window may exist if the agent crashes; doctor pass catches it.
- Restructuring `memon-drive` (it delegates to run-experiment; new model applies inside that delegation transparently).
- Repairing pre-change runs on disk that lack a Phase 1 record. Those stay as-is.

## Decisions

### Decision 1: Three explicit phases, not two

The user's wording named three distinct events: first write (proof-of-life), second update (stable RUNNING), and "during / at end" updates. Encode all three in the §3/§6 text rather than collapsing into two phases.

Phase 3 isn't a new section in the SKILL — it's the existing §7 (periodic check), §9 (success terminal), §10 (failure terminal), §11 (recovery loop). Those sections continue to write updates as they always have; we just relabel them as "Phase 3 updates" in the explanatory text so the model is coherent.

### Decision 2: Proof-of-life trigger is "RUN_DIR known AND run.log non-empty"

The bar is intentionally low — just two conditions:

1. `$RUN_DIR` was extracted from `[memon] RUN_DIR=...` in §3.
2. `$RUN_DIR/run.log` exists and has non-zero size.

This is "the script got past `mkdir -p` and `tee` is producing output". It catches both fast crashes (script ran, echoed `[memon]` lines, started doing something, crashed at step 5) AND happy starts. The only thing it doesn't catch is "script never produced any log output" — but that's the §3 fallback already (the contract says scripts emit the lines AND tee log; if they don't, hand off to the user / write-script for fixing).

A small wait + retry window is needed because the [memon] echo MAY fire before the log file flushes. Wait up to 5 seconds in 1-second polling; if still empty after that, hand the "no log content" case to the existing §3 fallback (don't write Phase 1; this case becomes §10b's "rare edge").

### Decision 3: Phase 1 status is `RUNNING`

Considered: introducing a `PENDING_RUNNING` or `LAUNCHED` intermediate status. Rejected:

- The status enum is project-wide (`PENDING/RUNNING/FINISHED/FAILED/UNKNOWN`). Adding a new value or repurposing `PENDING` (which today means "queued, not started") would cascade through many surfaces (the dashboard's status pill, the digest's status-transition events, the doctor checks, the `memon-cli` status commands).
- The "brief RUNNING-but-dead" window is real but small (seconds, not minutes), and is precisely what the doctor pass's `STALE_RUNNING` check is for.
- Phase 1's body explicitly says the Setup is `(pending — full setup written after stable RUNNING)`, which is a clear signal to a reader inspecting the README that this is the early version.

### Decision 4: `memon experiment link` moves from §6 to §3

The link must happen no later than the first README write to keep `<run>.experiment` and `<exp>.runs[]` in sync. Moving it to §3 (with Phase 1) is the cleanest implementation. §6 no longer calls `memon experiment link` — only an `expand the body` write.

§0's text that mentions "binding happens in §6" gets updated to reflect §3.

### Decision 5: §-numbering stays

Renumbering would require updating ~57 cross-references in the file. Net value: zero (the numbers are arbitrary anchors). Net cost: risk of breaking a reference. Decision: keep the existing numbers; just expand §3's content to absorb Phase 1.

### Decision 6: §4 (snapshot deposit) stays AFTER §3's Phase 1 write

Snapshots could move into Phase 1 itself (before §4), but:

- The README's `## Artifacts` section uses *paths* (`./code.diff`), not embedded content. The Artifacts list works regardless of whether the file is on disk yet.
- §4's existing logic handles both fresh-launch and resume snapshot naming. Moving it into §3 would intermingle that branching with Phase 1's simple flow.

So §4 stays where it is, but its preamble ("It does NOT write `README.md` — that's this skill's job, and it happens AFTER the stable check") is updated to reflect the new ordering: README has been written at §3 (Phase 1); now §4 deposits the snapshots its Artifacts list referenced.

### Decision 7: §10b becomes "rare edge case", not co-equal with §10a

After Phase 1, README always exists (unless §3's proof-of-life check failed and no Phase 1 happened, which is the §3 fallback case — script never produced `[memon]` lines or no log output). So §10's two branches become:

- §10a (the common path): README exists from Phase 1; flip to FAILED with mtime-locked update.
- §10b (rare edge): Phase 1 never fired. This now requires a manual run-dir construction (per the regex compliance rule from `skills-failed-run-name-anti-pattern`) plus a FAILED README from scratch.

§10b's text is shrunk and reframed as the edge case.

## Risks / Trade-offs

- **Risk**: agent writes Phase 1 README, then crashes before flipping to terminal. Stale RUNNING README sits on disk. → **Mitigation**: the digest doctor pass already detects `STALE_RUNNING` (see `memon-digest-journal` §3); on next digest sweep the user is asked whether to downgrade. The trade-off was explicitly accepted by the user.
- **Risk**: §3's proof-of-life wait window adds latency (up to 5s) to every launch. → **Mitigation**: 5s is negligible vs. a multi-hour run; for sync mode short scripts, the wait happens after the script already finished (since stdout was already captured), so it's actually instant.
- **Risk**: §10b becomes confusing because the cases are so asymmetric. → **Mitigation**: clear preamble in §10 explaining the asymmetry, and §10b's body shrinks accordingly. The §11 recovery loop's step 4 cross-reference stays valid.
- **Trade-off**: the spec scenario "the first README write happens after stable RUNNING" is fundamentally inverted. The MODIFIED requirement captures the new semantics; the old wording is fully replaced.

## Migration Plan

Pure skill-body edit. After apply:

1. Agents reading the new skill body write README at §3, then expand at §6, then update at terminal state.
2. Existing runs on disk are not touched — the new flow doesn't try to repair history.
3. No CLI or runtime change; the skill change is the entire scope.

Smoke verification: grep checks (per the acceptance gate in proposal.md). No build / typecheck / install-skills test changes expected.

Rollback: revert the change. Phase 1 disappears; flow returns to today's §6-as-first-write.

## Open Questions

None — the user has spec'd the three-phase model clearly enough to apply directly.
