## Why

The 8 existing bundled skills cover individual lifecycle steps (write a launcher, run a launcher, append a journal event, digest, write a report, brainstorm, migrate FS) but no single skill spans the **whole experiment session** — discussing a vague idea with the user, iterating until the next concrete action is settled, calling write-script / run-experiment as sub-tools, transcribing the conversation back into the exp doc as `## Plan` items / `## Caveats` notes / eventually `## Conclusion`, and surfacing FINISHED readiness when the cross-run picture stabilises.

Today the user has to manually orchestrate this loop: typing `/memon-propose` to brainstorm, then `/memon-write-script`, then `/memon-run-experiment`, then asking the agent to update the exp doc, repeat. Each handoff loses conversation context. The exp doc lags behind the discussion because no skill owns "keep this doc in sync with what we're talking about".

Adding a `memon-drive` skill — the long-running conversational orchestrator — gives the agent a single canvas to manage all of this on the user's behalf. It builds on the `## Plan` section landed by `add-experiment-plan-section` and the section-routing discipline encoded in `skills-plan-section-routing`.

## What Changes

### New skill: `packages/skills/memon-drive/SKILL.md`

A new SKILL.md (≈ 250–350 lines) with:

- Frontmatter: `name: memon-drive`, no `disable-model-invocation` (model-invocable per the policy update in `skills-allow-model-invocation`).
- `## Preflight — FS convention version`: standard pointer to `../PREFLIGHT.md` (5 lines, byte-equal to the other 7 spec-mutating skills).
- `## When to use` / `## When NOT to use` (4–5 bullets each).
- `## Two entry modes` — Mode A (start fresh) and Mode B (resume an existing exp).
- `## Workflow`:
  - §0 Discover or create the exp doc (snapshot via `memon experiment show`, branch on Mode A/B).
  - §1 Iterate design with the user until the next step is concrete (three pre-action gates: concrete action, defined I/O, success criterion).
  - §2 Execute Plan items:
    - 2a. New launcher needed → invoke `memon-write-script` as a sub-tool.
    - 2b. Existing launcher → invoke `memon-run-experiment` as a sub-tool.
    - 2c. **Inline analysis utility** (data-analysis python; reproducible in seconds-to-minutes given input; no GPU; no run dir) → write inline, **do NOT use `memon-write-script`**. The skill body includes a decision rule and a comparison table.
  - §3 Update the exp doc after each Plan item (flip `[ ]` → `[x]`, add reflection sub-bullet; conditionally update Method/Caveats/Conclusion per the routing matrix from `skills-plan-section-routing`).
  - §4 Continuously transcribe conversation into the exp doc as the user reveals motivation refinements, methodology decisions, caveats. **If unsure whether to record, ask the user (in Chinese).**
  - §5 Consider FINISHED — three-signal check (all `[x]`, all member runs terminal, Conclusion non-empty); surface to user; SHALL NOT auto-transition.
- `## Distinguishing launcher scripts from analysis utilities` — a dedicated section with a comparison table (output, lifecycle, GPU, wall time, `[memon]` echo, README ownership, Method registration, reproducibility test).
- `## Section-routing reference` — quick "this kind of content goes in that section" table, cross-referencing the rules in `memon-skills` spec.
- `## Anti-patterns`.

### Registry updates

- `packages/skills/src/index.ts`: add `'memon-drive'` to the `SKILL_NAMES` tuple. Position: first (drive is the orchestrator / entry-point skill).
- `packages/skills/README.md`:
  - "Pick the right skill for the job" matrix: add a new row for `memon-drive` at the **top** (it's the umbrella entry point). Matrix goes from 8 to 9 rows.
  - "Cross-skill handoffs" section: add a paragraph above the existing pipeline diagram clarifying that `memon-drive` is an umbrella orchestrator that calls `memon-write-script` and `memon-run-experiment` as sub-tools.
  - "Files written / never written, by skill" table: add a row for `memon-drive` describing what it writes (exp doc body sections) and what it never touches (run READMEs, scripts, digests, reports, JOURNAL).

### Sub-skill linkage

The new skill explicitly invokes `memon-write-script` and `memon-run-experiment` as sub-tools (per `skills-allow-model-invocation`, both are now model-invocable). It does NOT modify those two skills' bodies; it just references them.

Out of scope:
- Modifying any of the 8 existing SKILL.md files' bodies (except for the README and SKILL_NAMES registry edits noted above).
- Adding interactive Plan checkbox toggling (deferred to a possible v2 of `add-experiment-plan-section`).
- Adding any CLI subcommand for memon-drive (the skill orchestrates other CLI calls, doesn't have its own).
- Adding tests beyond verifying the new skill installs correctly via `memon install-skills`.

Acceptance gate (verifiable after apply):

- `packages/skills/memon-drive/SKILL.md` exists, is well-formed YAML frontmatter + markdown body.
- `grep "'memon-drive'" packages/skills/src/index.ts` matches in `SKILL_NAMES`.
- `pnpm --filter @memon/skills build` is clean.
- README matrix has 9 rows; `memon-drive` row is the first.
- README "Cross-skill handoffs" section names `memon-drive` as the umbrella.
- Smoke install: `node packages/cli/dist/index.js install-skills --project-root /tmp/drive-smoke --agent claude` succeeds, and `/tmp/drive-smoke/.claude/skills/memon-drive/SKILL.md` exists byte-equal to source.

## Capabilities

### New Capabilities

None. `memon-drive` is governed by the existing `memon-skills` capability.

### Modified Capabilities

- `memon-skills`: ADD a requirement that `memon-drive` is the 9th bundled skill (conversational orchestrator that calls `memon-write-script` and `memon-run-experiment` as sub-tools, maintains the exp doc's `## Plan` as its primary canvas, and distinguishes launcher scripts from inline analysis utilities).

## Impact

- **Code**: `packages/skills/src/index.ts` (one new entry in `SKILL_NAMES`).
- **Docs / skill bodies**: new file `packages/skills/memon-drive/SKILL.md`; `packages/skills/README.md` (matrix row + cross-skill section paragraph + files-written table row).
- **Specs**: delta on `memon-skills`.
- **Tests**: none required — the install-skills test uses a fake source dir; adding a real skill to the bundled source doesn't change that test's behavior. Smoke test verifies end-to-end deposit.
- **Migration risk**: zero. Pure additive change. Existing users who don't re-run `install-skills` after pulling this change keep their current 8-skill set; re-running picks up the 9th.
