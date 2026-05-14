## Context

Today (post-v3-to-v4 archive) the project is at `FS_CONVENTION_VERSION === 4`. The v4 schema:

- Experiment doc: `<projectRoot>/docs/experiments/E<NNNN>-<slug>.md` (single file). Frontmatter carries `id`, `slug`, `title`, `runs[]`, `hypotheses[]`, `tags[]`, `createdAt`, `updatedAt`, and (new in v4) `status`, `archived`.
- Run dir: `<projectRoot>/<...>/<slug>-<YYMMDD>-<HHMMSS>/README.md`. Body sections (canonical, today): Motivation / Setup / Method / Result / Conclusion / Caveats / Artifacts. The parser tolerates all of these; the web UI only renders Setup / Result / Artifacts.

The user wants three coupled shifts:

1. **Promote the exp doc to a folder.** Each experiment gains a sanctioned scratch space for its local artifacts (smoke scripts, sbatch templates, batch-launch helpers, ad-hoc figures). Mechanically: move the `.md` file into a same-named folder as `README.md`.
2. **Reshape the run README section policy.** `Motivation` / `Method` / `Conclusion` are now first-class optional sections, rendered when present. `Caveats` is removed from the run side (cross-run interpretation limits live only on the exp doc).
3. **Add a "you wrote a custom H2" parse warning.** With the migration script scanning READMEs for misplaced content, surfacing all unknown headings as warnings gives the user a single audit hook for run-doc drift.

The migration is `v4 → v5`. The bump is mostly mechanical on the exp side (one git mv per experiment); the run side has no on-disk format change, only a policy change about which sections are canonical.

## Goals / Non-Goals

**Goals:**
- Experiment folders are sanctioned with a single README inside; anything else in the folder is user-owned scratch and untouched by memon.
- Run README's `Motivation` / `Method` / `Conclusion` are canonical-optional and render in the web UI when populated.
- Run README's `Caveats` produces a parse warning (was tolerated, now flagged).
- Both parsers emit `UNKNOWN_H2_SECTION` warnings for non-canonical H2s. The doctor pass / digest sweep / web `parse_warnings` list surfaces them.
- The `v4-to-v5.md` migration guide includes a bulk-move shell loop and a run-doc scan helper that halts on content found in `Caveats` (or any unknown H2 with content).
- `FS_CONVENTION_VERSION` bumps to 5 atomically with the file moves.

**Non-Goals:**
- Touching the run dir's location, naming, or frontmatter shape. Those are unchanged.
- Adding any new frontmatter fields. v4's `status` / `archived` continue as-is.
- Adding a `Plan` section to the run README. `Plan` stays on the exp doc only.
- Auto-resolving misplaced content (e.g., moving Caveats content from run to exp). The migration HALTS and asks the user; resolution is human.
- Defining an "experiment scratch space" schema. The folder around `README.md` is opaque to memon. No globbing, no manifest, nothing.
- Skill updates. Deferred to the follow-up change per the split-runtime-from-skills rule.
- Migrating older guides (v3-to-v4 stays as-is). Only the new v4-to-v5 guide is added.

## Decisions

### D1. Folder layout: `<slug>/README.md`, opaque scratch space alongside

The new exp doc lives at `docs/experiments/E<NNNN>-<slug>/README.md`. Anything else under `E<NNNN>-<slug>/` (sibling files, sub-directories) is opaque to memon — not scanned, not linted, not deleted (except by `experiment delete --force`).

Alternatives considered:
- *Keep file form, add a sidecar dir*: `E<NNNN>-<slug>.md` + `E<NNNN>-<slug>.d/` (or `.<slug>/`). Rejected: the user wants the doc and its locals in one place, not split.
- *Folder with named index*: `E<NNNN>-<slug>/index.md` instead of `README.md`. Rejected: `README.md` is the cross-tool convention (GitHub, IDE previewers, search tools all default-render it).
- *Folder with manifest*: `E<NNNN>-<slug>/{README.md,manifest.yml}` to whitelist allowed sibling files. Rejected: over-prescriptive. The user wants free-form scratch.

### D2. Run README canonical sections post-v5

Order (matches reading flow): `Motivation` (optional) → `Setup` (required) → `Result` (required) → `Artifacts` (required). Four sections total.

`Method`, `Conclusion`, and `Caveats` are **removed** from the canonical list. The reasoning is that these aren't useful as separate sections on a run README:

- **Method** on a run README would either duplicate the parent exp's Method (noise) or be a per-run refinement of methodology — which is more naturally a sub-paragraph in `## Setup` (the run's setup IS the run's local methodology decisions). The run README has no Method section; setup absorbs the role.
- **Conclusion** on a run README is what `## Result` is already for — the per-run finding. A separate Conclusion section just splits the same content awkwardly across two H2s.
- **Caveats** is a cross-run interpretation limit, which lives on the parent exp doc by definition.

Parser behavior for these three forbidden run-side headings:

- `## Method` → `RUN_HAS_METHOD` warning, relocation hint "fold into this run's `## Setup`".
- `## Conclusion` → `RUN_HAS_CONCLUSION` warning, relocation hint "fold into this run's `## Result`".
- `## Caveats` → `RUN_HAS_CAVEATS` warning, relocation hint "relocate into the parent exp doc's `## Caveats`".

Each is `severity: 'warning'` when body is non-empty, `severity: 'info'` when body is empty (the migration script auto-cleans the dangling empty headings).

### D3. `UNKNOWN_H2_SECTION` parse warning

Both parsers (exp side and run side) walk H2 headings. Any heading not in the canonical list emits a `parseWarnings` entry of shape:

```ts
{ code: 'UNKNOWN_H2_SECTION', severity: 'warn', heading: <string>, line: <number>, message: 'Heading "## X" is not in the canonical section list; content is preserved verbatim but not categorised.' }
```

The body is preserved (the parser doesn't drop content); it just flags the deviation. The doctor / digest sweep surfaces these via the existing `parse_warnings` channel.

Rationale: today a user writing a custom H2 (say, `## Notes` on a run README) gets silent acceptance. With unknown sections flagged, the user sees the drift and can either rename to a canonical section, drop the content, or accept the warning as intentional.

### D4. Migration guide structure: seven sections per `fs-migration-guide-authoring/spec.md`

The guide at `packages/core/migrations/v4-to-v5.md` SHALL conform exactly:

1. `## Background / Why` — 2 paragraphs on the folder-promotion + run-section-policy rationale.
2. `## Detection` — literal shell commands to verify the project is currently v4: `jq -r .fs_convention_version .memon/version.json` returns `4`; `ls docs/experiments/E*.md` lists `.md` files (not yet `*/`).
3. `## Diff (v4 → v5)` — three per-file blocks:
   - `<projectRoot>/docs/experiments/E*.md` — bulk-move loop (`git mv` per file into a new same-named folder).
   - `<projectRoot>/<runDir>/README.md` — run-doc scan; on finding `## Caveats` content OR an `UNKNOWN_H2_SECTION`, the migration HALTS and surfaces the snippet to the user.
   - `<projectRoot>/.memon/version.json` — bump `fs_convention_version` 4 → 5; set `last_migrated_at`.
4. `## Target State (v5 Summary)` — paragraph + tree fragment showing the post-migration layout.
5. `## Verification` — shell block: `jq` the marker shows 5; `ls docs/experiments/` shows folders not files; `memon experiment ls` parses cleanly; no run README has `## Caveats` with non-empty body.
6. `## Rollback Notes` — `git reset --hard HEAD~1` reverts the migration commit; tarball-extract for non-git mode. Commit message: `chore(memon): migrate FS convention v4 -> v5` (ASCII arrow, per spec).
7. `## Edge Cases` — addresses the four canonical situations (missing file, custom frontmatter, dirty tree, concurrent migration) plus the new-in-this-guide cases (run README has Caveats content; exp folder name collision if `<slug>/` already exists as a file).

### D5. Run-doc scan halts on content, not on heading

The migration's run-doc scan reads each run README via the v5 parser:

- If `## Caveats` is present AND its body is non-empty → HALT, surface the snippet, ask user.
- If `## Caveats` is present AND body is empty → just delete the empty heading and continue (silent).
- If `UNKNOWN_H2_SECTION` is raised AND body is non-empty → HALT, surface, ask user.
- If `UNKNOWN_H2_SECTION` is raised AND body is empty → delete the empty heading and continue.

Halting on content (not on heading existence) avoids spamming the user with "you have an empty `## Notes` heading" when they don't care.

### D6. Web UI render order for the run page

The run detail page in `apps/web/components/run-page.tsx` (or equivalent) renders four `SectionCard`s in this order:

1. `Motivation` (skip if null — optional)
2. `Setup` (always rendered; placeholder if null)
3. `Result` (always rendered; placeholder if null)
4. `Artifacts` (always rendered; manual + auto file list)

The existing `Method`, `Conclusion`, and `Caveats` cards are removed entirely. If a legacy run README has any of those headings with non-empty content during the migration window, the content surfaces only via the `parse_warnings` banner at the top of the page (with the relocation hint per heading), not as a rendered section.

### D7a. Bundle the skill updates (exception to split-runtime-from-skills)

The `Split runtime then skills` memory rule says runtime and skill updates should ship as two separate changes with verification between them. The rule has an explicit exception: "a skill file that is *purely descriptive* (e.g. updating a path that moved as part of the runtime change) and would be immediately broken if not updated together. In that case, bundle."

Every skill update in this change qualifies:

- **Exp doc path strings**: `docs/experiments/E<NNNN>-<slug>.md` → `.../README.md`. These are literal path examples in SKILL.md bodies — they would point at a non-existent path after this change ships if not updated.
- **Run README schema reminders** in `memon-run-experiment`: today's body says "Body sections are `Setup / Result / Artifacts` only. The cross-run story (`Motivation`, `Method`, `Conclusion`, `Caveats`, `Warnings`) lives on the parent experiment doc". Post-v5, that's actively wrong: Motivation/Method/Conclusion are canonical-optional on the run side; Caveats is forbidden on the run side; Warnings still on the exp doc. Without the update, agents continue routing per the old policy and the new `RUN_HAS_CAVEATS` warnings start firing in real runs.
- **Entry-relative-path clarification**: today the skill says `entry: <script-relative-path>` ambiguously. The user has been observing entries that are sometimes absolute paths or relative-to-script, breaking discoverability. Tightening this to "relative to project root" is a one-line clarification in the skill — pure description, immediately needed.

The exception's safety guarantee — "would be immediately broken if not updated together" — is precisely met. Bundling is therefore the right call. No new behaviors are added in skill bodies; only stale text is brought into alignment with what the runtime now mandates.

### D7. Backward compatibility during the migration window

`discoverExperiments` and the experiment-doc readers SHALL tolerate BOTH layouts during the window between the user upgrading the memon binary (which has the v5 expectations) and running `memon-migrate-fs` (which moves the files). Specifically:

- If `E<NNNN>-<slug>/README.md` exists → that's the canonical v5 form.
- Else if `E<NNNN>-<slug>.md` exists → legacy v4 form, surface a `LEGACY_LAYOUT` parse warning naming `memon-migrate-fs` as the resolution.
- Else → `NOT_FOUND`.

After the migration runs, the `.md` files are gone (renamed by `git mv`), so the legacy branch never fires in normal operation.

## Risks / Trade-offs

- **Risk**: a project root with thousands of experiments produces thousands of `git mv` commands; the migration commit becomes huge. → **Mitigation**: the loop is a single `git mv` invocation list, no parallelism, no special handling needed. `git` handles large rename batches well. The commit message stays the canonical one-liner per spec.
- **Risk**: a user has manually placed files at `docs/experiments/E<NNNN>-<slug>/` (already a folder for some reason — maybe their own scratch). → **Mitigation**: the migration script detects this conflict pre-move and halts (Edge Case in the guide). The user resolves manually.
- **Risk**: web `open-claude-code` returns the folder; existing agents in older versions of the memon-skills might expect the file path. → **Mitigation**: the post-v5 skills update fixes this. During the transition, the agent gets a folder cwd and `claude` runs from there — most paths still resolve correctly (the exp README is `README.md` in the cwd).
- **Risk**: the parser change (Caveats now warns) breaks existing test fixtures that assert clean parses on legacy run READMEs containing `## Caveats`. → **Mitigation**: those fixtures need updating as part of this change's test pass. Listed in tasks.md.
- **Trade-off**: by flagging unknown H2 sections as warnings, the user may get noise from intentional custom sections (e.g., they want `## Findings` for personal organisation). → **Mitigation**: warnings are warnings — they don't block anything, just appear in `parse_warnings` for the user to triage. If a custom section pattern emerges as common, a future change can extend the canonical list.
- **Trade-off**: the "scratch space" around the README is fully opaque to memon. memon won't index user scripts, won't lint them, won't show them in the dashboard. → Accepted: this is exactly what the user asked for ("这种非常 local 的东西就可能没有必要放到主仓库中，就还是我们自己管理比较好").

## Migration Plan

1. **Land runtime first** (this change). Verify by manual exercises against a fresh project:
   - `memon install-skills` against the test project; PREFLIGHT.md still deposited (no regression on v3→v4 carrying changes).
   - Pre-seed the test project at v4 (one exp doc file at the old path; one run README with `## Caveats`; one with a custom `## Notes` H2).
   - Run `memon-migrate-fs` (the user invokes; this skill is unmodified). The runtime picks up the new `v4-to-v5.md` guide automatically.
   - Verify (per the guide's `## Verification`): marker bumped to 5; exp doc at new folder path; run README's empty caveats gone; the one with content + the one with custom H2 each surfaced for user resolution.
2. **User confirms** the migration completed end-to-end on the test project; the web UI renders the new layout; CLI commands resolve.
3. **Then propose the skills update** (`skills-update-for-v5-and-run-sections`) — separate change. Skill bodies update to reference folder paths, run README schema reminders update, anti-patterns add Caveats-in-run and unknown-H2 bullets.

Rollback (per the guide's `## Rollback Notes`): `git reset --hard HEAD~1` reverts the migration commit (folder unwinds back to `.md` files; marker drops back to 4); rerun `memon-migrate-fs` later when ready. Non-git mode: `tar -xf .memon/backups/post-v5-*.tar.gz` from before the migration commit.

## Open Questions

- Should `memon experiment delete` with the default no-flag behaviour refuse when the folder has non-README content (so the user doesn't lose scratch by accident), and `--force` is required to nuke the whole folder? Or should default-delete remove only `README.md` and leave the folder + scratch, surfacing "folder still exists" as a warning? → **Leaning toward**: default-delete requires `--force` if the folder has non-README content (treats the scratch as user data); refuse with a clear message otherwise. To be confirmed during apply if the implementation surfaces edge cases.
- Run README's `Method` optional vs. mandatory: today the runtime treats it as null-tolerant (parses fine if absent). Keep that. The web UI renders it only when present. → Resolved: optional throughout.
- Should `UNKNOWN_H2_SECTION` be configurable (e.g., a project-level whitelist of accepted custom sections)? → No — out of scope for this change. If the pattern becomes common, a future change can add a whitelist.
