## Why

The v4 on-disk schema stores each experiment as a single file at `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md`. As the project scales, the user accumulates **experiment-local** artifacts — smoke-run scripts, sbatch templates, multi-launch helpers, ad-hoc analysis figures — that are tightly coupled to one specific experiment but don't belong in the main repo (too local) and don't fit in any single run dir (they're cross-run within the experiment). Today these artifacts are homeless: they end up scattered under `scripts/<area>/`, in scratch dirs, or lost.

The fix is to **promote each experiment from a single file to a folder**: `E<NNNN>-<slug>.md` → `E<NNNN>-<slug>/README.md`. The README continues to carry the experiment doc body (Motivation/Method/Plan/Conclusion/Caveats/Warnings); the folder around it becomes a sanctioned home for experiment-local artifacts that the user wants to keep alongside the doc.

This change also bundles two parser/UI policy fixes that surfaced during the user's review of the run README rendering:

1. **Run README section discipline**: the parser already tolerates `Motivation` / `Method` / `Conclusion` / `Caveats` on the run side, but the web UI doesn't render them, and the skills push them all onto the exp doc. The user wants (post-clarification):
   - `Motivation` remains as an **optional** run-side section AND is rendered by the web UI when present (in rare cases the per-run motivation differs from the parent exp's).
   - `Method` is **disallowed** on the run side — methodology content lives in `## Setup` of the same run README (per-run methodology refinements are part of the run's setup, not a separate section).
   - `Conclusion` is **disallowed** on the run side — per-run conclusions live in `## Result` of the same run README.
   - `Caveats` is **disallowed** on the run side — cross-run interpretation limits live on the exp README only.
2. **Unknown H2 sections produce parse warnings**: today, a user-created custom H2 in an exp or run README silently passes through. With the migration script scanning READMEs for misplaced content (Caveats in run, etc.), surfacing unknown sections as parse warnings gives the user a fixed audit hook.

## What Changes

### File model v4 → v5 (the main thing)

- **Experiment doc location**: `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md` → `<projectRoot>/docs/experiments/E<NNNN>-<slug>/README.md`. The body content (frontmatter + H2 sections) and v4 frontmatter shape (incl. `status`, `archived`) are preserved byte-for-byte; only the file location changes.
- **Experiment folder is a sanctioned scratch space**: any file or subdirectory under `E<NNNN>-<slug>/` other than `README.md` belongs to the user. memon SHALL NOT modify, validate, parse, or auto-discover those files. The user uses the folder for smoke-run scripts, sbatch templates, multi-launch helpers, etc.
- **Discovery glob updates**: `discoverExperiments` scans `docs/experiments/E<NNNN>-<slug>/README.md` instead of `docs/experiments/E<NNNN>-<slug>.md`. Legacy `.md` files (detected outside the v4→v5 migration window) emit a parse error pointing at migrate-fs.
- **CLI updates**: `memon experiment create` makes the folder + writes `README.md` inside it. `memon experiment show / ls / link / unlink / delete / readme write / status set` resolve paths through the new layout. The `delete --force` cascade removes the whole folder (including user files; `--force` confirmation is the gate).
- **Web endpoint updates**: `GET /api/experiments/:id` and `PUT /api/experiments/:id/readme` resolve the new path. `POST /api/open-claude-code` returns `cd <projectRoot>/docs/experiments/E<NNNN>-<slug>` (the folder, not the file), so an agent dropped in by the user lands inside the experiment's local scratch space.
- **`FS_CONVENTION_VERSION`**: bump from `4` to `5`.

### Run README section policy

- **Run-side STANDARD section list** (post-v5): `Motivation` (optional) / `Setup` (required) / `Result` (required) / `Artifacts` (required) — **four** sections total. The change vs. v4:
  - `Motivation` is explicitly canonical-optional. Rendered when present.
  - `Method`, `Conclusion`, `Caveats` are **removed** from the run-side canonical list. Each has a designated relocation home:
    - `Method` content → fold into the same run's `## Setup` (methodology is part of setup).
    - `Conclusion` content → fold into the same run's `## Result` (per-run findings).
    - `Caveats` content → relocate to the **parent experiment doc's** `## Caveats`.
  - A parser encountering any of `## Method` / `## Conclusion` / `## Caveats` on a run README SHALL emit a parse warning with the relocation hint (codes: `RUN_HAS_METHOD` / `RUN_HAS_CONCLUSION` / `RUN_HAS_CAVEATS`). Empty headings get `severity: 'info'` for the migration script to auto-clean.
- **Web UI**: the run detail page renders four `SectionCard`s in canonical order: `Motivation` (if present) → `Setup` → `Result` → `Artifacts`. The `Method` / `Conclusion` / `Caveats` cards are NOT rendered. The parse-warnings banner surfaces the relocation hints if any forbidden heading appears.
- **Migration guide v4-to-v5**: the run-doc scan SHALL detect `## Method`, `## Conclusion`, and `## Caveats` content on run READMEs, halt-and-surface to the user with the correct relocation target for each.

### Unknown H2 sections produce parse warnings

- The exp parser (`packages/core/src/experiments/parse.ts`) already detects H2 headings not in `STANDARD_EXPERIMENT_SECTIONS`. Today it MAY emit a warning in some paths; the change is to make this **always** emit a `PARSE_WARNING` (severity `warn`) with code `UNKNOWN_H2_SECTION` and a clear message naming the offending heading.
- The run parser (`packages/core/src/readme/parse.ts`) gains the equivalent behavior against `STANDARD_RUN_SECTIONS` (the new post-v5 canonical list). Same `UNKNOWN_H2_SECTION` code.
- These warnings flow through to `memon doctor` / `memon-digest-journal`'s integrity sweep and to the web `parse_warnings` field, so the user can see "you wrote a custom H2 — intended?" in the dashboard.

### Migration runtime artifacts

- New guide: `packages/core/migrations/v4-to-v5.md`, following the seven-section structure mandated by `openspec/specs/fs-migration-guide-authoring/spec.md` (Background / Detection / Diff / Target State / Verification / Rollback Notes / Edge Cases).
- The guide's **Diff** section includes:
  - File-move script: for each `E<NNNN>-<slug>.md` under `docs/experiments/`, create `E<NNNN>-<slug>/` and `git mv` the file to `E<NNNN>-<slug>/README.md`. Single shell loop, deterministic.
  - Run-doc scan: walk every run dir's `README.md`; for each, run the v5 parser and surface any `UNKNOWN_H2_SECTION` warnings AND any `## Caveats` content found. The migration HALTS pending user adjudication when content is found (the agent surfaces the snippets and asks the user where each one belongs — into the parent exp's `## Caveats`, dropped, or kept as a custom section the user accepts).
  - `.memon/version.json` bump: `fs_convention_version: 4` → `5`, `last_migrated_at` set to now.

### Skill updates (bundled into this change)

Per the `Split runtime then skills` memory rule's exception clause — "a skill file that is *purely descriptive* (e.g. updating a path that moved as part of the runtime change) and would be immediately broken if not updated together. In that case, bundle." — the skill body edits for this migration ARE bundled in. Without them, agents reading the unchanged SKILL.md bodies would:
- Continue referencing `docs/experiments/E<NNNN>-<slug>.md` (a path that no longer exists post-v5).
- Continue writing `## Caveats` on run READMEs (now triggers `RUN_HAS_CAVEATS` parse warning).
- Continue treating Motivation/Method/Conclusion as run-side anti-patterns (now they're canonical-optional).

In-scope skill updates:

- **All affected `packages/skills/memon-*/SKILL.md` files** that reference exp doc paths get path strings updated from `docs/experiments/E<NNNN>-<slug>.md` to `docs/experiments/E<NNNN>-<slug>/README.md`. The frontmatter and structure of each skill stays otherwise unchanged.
- **`memon-run-experiment/SKILL.md` "Run README schema reminders"** paragraph rewrites to reflect the new canonical run-side section list: `Motivation` / `Setup` / `Method` / `Result` / `Conclusion` / `Artifacts`, with `Motivation` / `Method` / `Conclusion` documented as optional. `Caveats` removed from run-side; a new anti-pattern bullet forbids putting Caveats content on run READMEs.
- **`memon-run-experiment/SKILL.md` Phase 1 + Phase 2 README write blocks** clarify that the `entry:` frontmatter field is a path **relative to the project root** (concern (1) from the user's review — today the skill says `entry: <script-relative-path>` ambiguously). Example: `entry: scripts/erdos/run.sh` (not `entry: /home/.../scripts/erdos/run.sh`, not `entry: run.sh`).
- **`memon-drive/SKILL.md` Section-routing reference table** updates to reflect the new run-side section policy + the unchanged exp-doc-side routing.
- **`memon-write-script/SKILL.md` "Register the script" section** clarifies the script path stored in the exp doc's Method body is relative to project root (same convention as `entry:`).
- **`memon-propose/SKILL.md` §1 (Snapshot the project)** updates the exp-doc read example to use the new path.
- **`memon-digest-journal/SKILL.md`** updates any exp-doc path references.
- **`memon-write-report/SKILL.md`** updates any exp-doc path references (it primarily writes `docs/reports/`, but cross-skill mentions of exp paths get the update).
- **`memon-append-journal/SKILL.md`** and **`memon-append-warning/SKILL.md`** update any exp-doc path references.
- **`memon-migrate-fs/SKILL.md`** is mostly unchanged (the skill body already reads from `packages/core/migrations/v<N>-to-v<N+1>.md` dynamically; the new v4-to-v5 guide is picked up automatically). One paragraph in the body's introduction may be tightened to mention the new v5 layout in the "what gets migrated" overview.
- **`packages/skills/README.md`** matrix / cross-skill table updates: the "Files written / never written" row for `memon-drive` / `memon-run-experiment` / etc. reflects the new exp-folder layout where appropriate.
- **A new anti-pattern bullet** is added to `memon-run-experiment/SKILL.md` calling out that putting `## Caveats` content on a run README produces a parse warning and that the content belongs on the parent exp doc.
- **A new anti-pattern bullet** is added to several SKILL.md files calling out that creating custom H2 sections produces an `UNKNOWN_H2_SECTION` warning — either rename to a canonical heading or accept the warning, but don't write custom H2s silently.

Excluded from scope:
- Restructuring any skill body beyond the descriptive path / section-list / entry-relative updates above. Larger conceptual changes (e.g. revising the `memon-drive` workflow model) are deferred.
- Adding new skills.
- Modifying `disable-model-invocation` flags.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `experiment-readme`: exp README's canonical location changes to `docs/experiments/E<NNNN>-<slug>/README.md`. The body section list and frontmatter shape are unchanged. Parser SHALL emit `UNKNOWN_H2_SECTION` warning for non-canonical H2 headings.
- `run-readme`: canonical section list changes to `Motivation` / `Method` / `Setup` / `Result` / `Conclusion` / `Artifacts`. `Caveats` is removed; parser SHALL emit a warning if it appears. Parser SHALL emit `UNKNOWN_H2_SECTION` warning for any H2 not in the post-v5 canonical list.
- `fs-version-tracking`: `FS_CONVENTION_VERSION` bumps to 5.
- `experiment-discovery`: scans the new folder-based layout.
- `experiment-edit`: `PUT /api/experiments/:id/readme` writes the new path; `POST /api/open-claude-code` returns the folder path for exps.
- `web-dashboard`: renders optional run-side sections; drops the run-side `Caveats` card; surfaces parse warnings (UNKNOWN_H2_SECTION + run-side Caveats) on detail pages.
- `fs-migration-runtime`: knows about the v4-to-v5 guide; existing runtime + commit-message rules unchanged.
- `fs-migration-guide-authoring`: scenarios bump to mention `FS_CONVENTION_VERSION === 5` (was 3 in the scenario; v3-to-v4 already exists so already stale — this change updates the scenario count accordingly).
- `memon-cli`: `memon experiment create/show/ls/link/unlink/delete/readme write/status set` use new path resolution.
- `memon-skills`: 9 bundled SKILL.md files get descriptive updates (exp-doc paths now folder-based; run README schema reminders rewritten; `entry:` field documented as project-root-relative; new anti-patterns for run-side Caveats + custom H2 sections).

## Impact

- **Code — `packages/core`**: discovery loop (file → dir layout); parser warning emission for unknown H2; run-side section list adjustments; `FS_CONVENTION_VERSION` bump; migration guide file added.
- **Code — `packages/cli`**: every command that resolves an exp doc path; `memon experiment delete --force` cascade folder-aware; `open-claude-code` returns folder.
- **Code — `apps/web`**: route handlers that read/write `/api/experiments/:id/...`; experiment detail page renders the moved file; run detail page renders new optional sections + drops Caveats card; surfaces unknown-section warnings.
- **Tests**: parser round-trip tests for the new layout + section list; CLI integration test that creates an exp under the new layout and resolves it; web test that renders Motivation/Method/Conclusion run cards.
- **Migration**: the `v4-to-v5.md` guide ships with a bulk-move shell loop and a run-doc scan helper. `memon-migrate-fs` skill picks the guide up automatically (no change to that skill in THIS change — it's the runtime entry point that reads any new guide that appears under `packages/core/migrations/`).
- **Backward compatibility window**: during the migration step, the parser MUST tolerate BOTH layouts (file form for the pre-bump state, folder form for the post-bump state). After all guides have run, only the folder form is canonical.
- **Skills**: modified IN this change (per the descriptive-skill-update exception to the split-runtime-from-skills rule). 9 SKILL.md files + `packages/skills/README.md`. The updates are mechanical (path strings, section-list text, anti-pattern bullets) — not workflow restructures.
