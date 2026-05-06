## Context

Today the term "experiment" in memon refers to a single directory under a
project's `logs/` tree. Its `README.md` carries everything: motivation,
method, hardware, command, result, conclusion, warnings, artifacts. In real
research one investigation usually produces several runs (sweep over CFG
values, ablate on dataset, re-run after a fix, switch base model). Today the
user must either copy the motivating prose across N run READMEs or pick one
"canonical" run and treat the rest as orphans linked only by tags.

We split the file model into two tiers:
- An **experiment** (`docs/experiments/E<NNNN>-<slug>.md`) owns the cross-run
  story — motivation, method, conclusion, caveats, warnings — plus a list of
  member runs.
- A **run** (`logs/<slug>-<YYMMDD>-<HHMMSS>/README.md`) owns its execution
  facts — setup, result, artifacts produced — plus a back-reference to its
  parent experiment.

This document pins the decisions reached in the design discussion that
preceded the change (the Q1–Q23 thread) so that the apply phase has no
ambiguity.

The repo's hard rules from `CLAUDE.md` continue to apply:
- ISO8601 timestamps with explicit timezone offset, never UTC.
- Status enum uppercase.
- No `fs.watch`/`chokidar`; polling with exponential backoff.
- mtime + content-hash optimistic locking for README writes.
- All path-accepting backend routes go through `assertWithinProjectRoots()`.

## Goals / Non-Goals

**Goals:**
- Introduce the experiment doc layer with bidirectional binding to runs.
- Bump `FS_CONVENTION_VERSION` from 2 to 3 with an agent-led migration guide.
- Re-shape the web app so an experiment is the unit of navigation; runs render
  as collapsible panels inside the experiment page.
- Add `memon experiment …` CLI subcommands (full word, no `exp` abbreviation)
  and `memon run rename`.
- Migrate `mock/` data to v3 (with fictional details introduced for a coherent
  demo dataset).
- Define a clear anomaly model (orphan run / phantom run ref / mismatch) so
  inconsistencies between the two sides surface in the UI as a copyable
  report instead of silently disappearing.
- Update the editor save handshake so the frontmatter `updated_at` field is
  authoritative for "when did the human last touch this doc."

**Non-Goals:**
- Skill content updates (`.memon/skills/*.md` templates installed by
  `memon install-skills`). The version marker advances to v3 in this change,
  but the skill *content* upgrade is deferred to an immediate follow-up
  change. The user has explicitly chosen this split so the web/CLI/mock work
  can stabilize before the skill prompts get rewritten.
- Cross-project experiments (one experiment spanning multiple `config.yml`
  project roots).
- Structured per-section schemas for `Conclusion` (hypothesis verdicts stay
  free-form prose; the structured truth lives in `docs/hypotheses.md`).
- Auto-deriving experiment groupings from existing runs (the migration is
  agent-led with explicit user confirmation; we do NOT ship a heuristic
  clusterer).
- Renaming reports from `R<NNNN>` to free up the `R` prefix for experiments.
  We chose `E` instead.

## Decisions

### D1. ID prefix is `E`, four-digit zero-padded

`docs/experiments/E<NNNN>-<slug>.md` with `<NNNN>` ∈ `0001..9999`.
`packages/core/src/ids.ts`'s `ID_PREFIXES` array gains `'E'`. ID assignment
is per-project monotonic: `memon experiment create <slug>` scans
`docs/experiments/E*.md`, takes `max + 1`, formats with `padId('E', n)`.
There is no central allocator and no lock — single-user assumption holds.

**Alternatives considered:** Reusing `R` (Reports) was rejected because the
ID-set collision (`R0001` could mean either a report or an experiment) would
make cross-references in journal/hypothesis docs ambiguous. Renaming reports
to a different prefix to free up `R` was also rejected — too invasive for
no real benefit.

### D2. Codepaths use the spelled-out word `experiment`, not `exp`

Field names (`experiment:` in run frontmatter), CLI verbs
(`memon experiment ls`), spec capability names (`experiment-readme`),
API routes (`/api/experiments/...`), and TypeScript type names use the
full word — never the abbreviation `Exp`. The only place the short form
is allowed is the URL path segment (`/p/<project>/e/<id>`) and the
filename ID prefix `E<NNNN>` — both legitimate concise identifiers, not
abbreviations of a code term.

**TypeScript symbol rename**: The v2 codebase used the symbol
`Experiment` (and its kin: `ExperimentFrontMatter`, `ExperimentSections`,
`ExperimentIndex`, `IndexedExperiment`, `EXPERIMENT_DIR_REGEX`,
`discoverExperiments`, `archiveExperiment`, `unarchiveExperiment`,
`readExperimentDir`, `formatExperimentStamp`, `experimentId`) to mean
what v3 calls a *run dir*. Apply phase A renames every one of those
symbols to its v3 equivalent (`Run`, `RunFrontMatter`, ..., `runId`)
across `packages/core/src`, `packages/cli/src`, and `apps/web/`. Phase
B then claims the v3 names for the new experiment-doc concept:
`Experiment`, `ExperimentFrontMatter`, `ExperimentSections`,
`ExperimentWarningRecord`, `ExperimentEffectiveTimes`, plus
`ExperimentMembershipAnomaly{Code}` and
`EXPERIMENT_FILENAME_REGEX`.

The two passes are word-boundary sed (`\bX\b → Y`), in dependency order
(longer names first), with a typecheck + unit-test gate after each
pass. The package's `dist/` is rebuilt between core and cli/web
typechecks because cross-package consumers resolve types through
`./dist/index.d.ts`.

### D3. Section split between exp and run

| Section | Lives in |
|---|---|
| Motivation | experiment doc |
| Method | experiment doc |
| Conclusion | experiment doc |
| Caveats | experiment doc |
| Warnings (with `Run` column) | experiment doc |
| Setup (incl. inputs like ckpt paths, datasets) | run doc |
| Result | run doc |
| Artifacts (manual list of intended outputs) | run doc |

The old `## New Hypotheses` section is **removed** entirely. Hypothesis
mentions live freely inside `Motivation` ("we are testing H0003...") and
`Conclusion` ("supports H0003 / refutes H0001 / suggests new H_???"). The
structured truth for hypothesis state is `docs/hypotheses.md`, which gains
a per-H `Runs:` field (D14 below) so a hypothesis can name *either* an
experiment or specific runs.

The `Artifacts` section remains a **manually-maintained** description of
intended/expected outputs. The web UI augments this with an automatic
listing of files actually present in the run directory; the two are
complementary. The intended-vs-actual distinction was a recurring source of
confusion in v2 — making it explicit is the resolution.

### D4. Frontmatter split

**Experiment doc** (required unless noted):
- `id` — must equal the file basename's `E<NNNN>-<slug>` portion
- `slug` — must equal the file basename's slug portion (the part after
  `E<NNNN>-`)
- `title` — human-readable name
- `runs` — array of run dir base names (e.g. `["zero-snr-260502-110000",
  ...]`); paths are resolved against the project's logs root at index time
- `hypotheses` — array of `H<NNNN>` (no slug)
- `tags` — array of strings
- `created_at` — ISO8601 with offset; the time the doc was first written
- `updated_at` — ISO8601 with offset; bumped on every edit
- `project` — explicitly **NOT a field**. Membership is determined
  structurally by `config.yml`'s project roots, the same way runs are.

**Run doc** (existing fields preserved unless noted):
- `id` — must equal the directory base name
- `experiment` — `E<NNNN>-<slug>` of the parent experiment; required when
  the run is bound (single value, not an array)
- `name` — slug part of the dir name (already present)
- `status` — uppercase enum (already required)
- `created_at` — ISO8601 with offset; **defaults to the dir-name timestamp
  parse** when the field is missing
- `updated_at` — ISO8601 with offset; **defaults to `created_at`** when
  missing; web/CLI edits bump it explicitly
- `finished_at`, `host`, `pid`, `gpus`, `entry`, `command`, `wandb` — kept
- **Removed**: `project` (sub-project label; D22), `hypotheses` (moved to
  exp), `tags` (moved to exp)

### D5. Effective time is computed at read, not stored

The on-disk `created_at` / `updated_at` on the experiment doc reflect *when
the doc itself was created/last edited*. The API surface adds two derived
fields when serving an experiment:
- `effective_created_at = min(experiment.created_at, ...member_runs.created_at)`
- `effective_updated_at = max(experiment.updated_at, ...member_runs.updated_at)`

The frontend uses the `effective_*` values for display (the experiment-card's
📅 / ✎ icons in the list view). Stored values are never auto-rewritten by
the backend.

### D6. Bidirectional binding by intersection

A run is a member of experiment `E` iff:
1. `<run>.experiment === E.id`, AND
2. `E.runs[]` contains the run's dir base name.

A unilateral claim — only one side asserts the link — is NOT a membership.
It surfaces a typed anomaly:

| Code | Condition |
|---|---|
| `ORPHAN_RUN` | run dir exists, has no `experiment:` field, and is in no exp's `runs[]` |
| `PHANTOM_RUN_REF` | exp lists a run dir name that does not exist (or has no README) |
| `MISMATCH_EXPERIMENT_REF` | run says `experiment: E_a`, but `E_a.runs[]` doesn't contain it (or vice versa) |

Anomalies are stored on the in-memory index (not on disk) and exposed via
`/api/anomalies` for the web banner. They self-resolve as soon as both
sides agree — common case is a transient mid-edit window.

**Alternatives considered:** "single-side authority wins" was rejected
because it silently swallows user mistakes; the user cannot tell whether
the experiment doc or the run README is wrong. Making both sides
authoritative-individually was rejected because it doubles the number of
duplicate-link cases. Intersection is the cleanest semantically: a binding
exists when both parties agree.

### D7. Editor save handshake

When the user clicks Save in the web markdown editor (whether on an
experiment or a run README):

1. Frontend captures `now()` as ISO8601 with the user's local offset.
2. Frontend rewrites the YAML frontmatter `updated_at` field in the editor
   buffer to that timestamp.
3. Frontend POSTs `{ content, expectedMtime }` to the existing
   `PUT /api/readme` endpoint (or its experiment equivalent).
4. Backend runs the existing optimistic-mtime + content-hash check; on
   success, writes and returns `{ newMtime, finalContent }`.
5. Frontend replaces the editor buffer with `finalContent` and stores
   `newMtime` as the new `expectedMtime` for the next save.
6. On 409 conflict, the frontend rolls back its own `updated_at` bump
   (visually) and surfaces the existing conflict UI.

**Alternative considered:** server-side bump (backend rewrites
`updated_at` on receipt). Rejected because it would force every
README-write code path through the YAML rewriter, and the section-bound
writer for `Warnings` (which never touches the top-of-file frontmatter
range) would have to grow an exception. Frontend-side bump confines the
rewrite to the editor's content path.

### D8. Run slug uniqueness; one run, one experiment

The slug part of every run dir name (the portion before `-<YYMMDD>-<HHMMSS>`)
SHALL be unique within a project. Two runs `foo-260501-100000` and
`foo-260502-130000` collide on slug `foo` and are illegal.

Each run belongs to **at most one** experiment. A run cited by another
experiment for analysis purposes is a *reference*, not membership; the
analysis experiment's prose can mention the run, but `E_analysis.runs[]`
SHALL NOT contain it and `<run>.experiment` SHALL NOT name it.

Validation is enforced at the indexer level (a parse warning surfaces a
collision; the duplicate is preserved for inspection but flagged).
`memon run rename` checks for collision before performing the rename.

### D9. Naming convention rules

| Rule | Strength | Enforcement |
|---|---|---|
| Run slug per-project unique | Hard | indexer warning + `memon run rename` collision check |
| Experiment slug per-project unique | Hard | indexer warning + `memon experiment create` collision check |
| Experiment slug NOT a prefix of another experiment's slug | Hard | indexer warning |
| Experiment slug IS a prefix of every member run's slug | Soft | `memon experiment link` warns; `memon doctor` reports; `memon run rename` is the suggested fix |

The soft rule is helpful because it makes the experiment ↔ run relationship
visually obvious in `logs/` listings, but enforcing it would block legitimate
cases (e.g. an analysis experiment loaded from a run originally named for
its training context).

### D10. URL / route structure

| Path | Purpose |
|---|---|
| `/p/<project>` | experiment-card grid (the main list page) |
| `/p/<project>/e/<E0001-slug>` | experiment detail page |
| `/p/<project>/e/<E0001-slug>?run=<run-dir>` | exp page with run panel auto-expanded |
| `/p/<project>/r/<run-dir>` | **redirect** → corresponding `e/...?run=...` URL |
| `/api/experiments` | NEW: returns experiments list/detail (semantically NEW) |
| `/api/runs` | NEW: returns runs list/detail (this is what `/api/experiments` did in v2) |
| `/api/experiments/:id/anomalies` | new: all anomalies touching this exp |
| `/api/anomalies` | new: project-wide anomaly list |

The legacy `/api/experiments` semantics flip is breaking — but there are no
external clients of this API, so a hard cut-over is fine.

### D11. Anomaly UI and copy-paste

A pinned yellow card sits at the **top** of the experiment-card grid,
visible only when at least one anomaly exists. Layout:

```
┌──── ⚠ 3 issues need resolution ──────── [Copy all] [Hide] ─┐
│ ORPHAN_RUN: foo-260501-100000 has no experiment binding   │
│ PHANTOM_RUN_REF: E0002-bar references run baz which …      │
│ MISMATCH: run qux says E0003, but E0003.runs[] is missing… │
│                                              (scroll …)    │
└────────────────────────────────────────────────────────────┘
```

The card is `max-h-[40vh] overflow-y-auto`. The "Copy all" button copies a
plain-text block formatted as:

```
Anomalies from project <name> at <ISO time>:
- ORPHAN_RUN: <run-dir> — <message>
- PHANTOM_RUN_REF: <exp-id> -> <run-dir-name> — <message>
- MISMATCH_EXPERIMENT_REF: <run-dir> claims <E-id-a>; <E-id-b>'s runs[] lists it — <message>
```

so the user can paste it into a Claude Code session for resolution. Hide
state is per-session (sessionStorage), not persisted across days.

### D12. Web list page = experiment-card grid

Each card:
```
┌────────────────────────────────────────────────────────────┐
│  📝 E0001-zero-snr-fix          🟢 2 / 5 runs              │
│  Zero terminal-SNR brightness study                         │
│  ─────────────────────────────────────────────────────     │
│  ✅ zero-snr-260502-110000      11:05  2h 25m   📁 8       │
│  🟢 zero-snr-cfg-260503-090000  09:00  running  📁 3       │
│  📝 zero-snr-rescale-260504-…   pending  -      📁 0       │
│  ─────────────────────────────────────────────────────     │
│  #zero-snr  #compbench  #brightness                         │
│                              📅 2026-05-02  ✎ 2026-05-04    │
└────────────────────────────────────────────────────────────┘
```

- Header: emoji-status (aggregate of all member runs), exp ID + slug,
  `<finished>/<total>` runs counter, title.
- Embedded runs table: status emoji, run dir name, created_at time-of-day,
  `finished` / `running` / duration, file count.
- Footer left: tags. Footer right (desktop): 📅 effective_created_at,
  ✎ effective_updated_at. On mobile, tags and times stack.
- Click anywhere on a row → navigate to `/p/<project>/e/<id>?run=<run-dir>`.
- Click on the card header → navigate to `/p/<project>/e/<id>`.

Orphan runs are rendered as **special cards** mixed into the same grid:
greyed border, header reads `⚠ Unassigned: <run-dir>`, single-row "table",
no tag/time footer. The yellow anomaly banner is the canonical place to
*see all anomalies at once*; the orphan cards in the grid let the user
*navigate to* an unassigned run when they want to fix it.

### D13. Experiment detail page

Layout:
```
┌── header: title • status pill • effective times • tags • H-refs ─┐
│  [Edit markdown] [Open Claude Code]                              │
├──────────────────────────────────────────────────────────────────┤
│  ## Motivation                                                   │
│  ## Method                                                       │
│  ## Conclusion                                                   │
│  ## Caveats                                                      │
│  ## Warnings  ┌── table ──┐                                      │
├──────────────────────────────────────────────────────────────────┤
│  Runs (5)                                                        │
│  ┌── panel: run-1 (expanded) ──────────────────────────────┐     │
│  │   frontmatter • Setup • Result • Artifacts •            │     │
│  │   file listing • log tail                               │     │
│  │   [Edit markdown (run)] [Open Claude Code (run)]        │     │
│  └─────────────────────────────────────────────────────────┘     │
│  ┌── panel: run-2 (expanded) ──────────────────────────────┐     │
│  │   ... skeleton until /api/runs/<id> resolves            │     │
│  └─────────────────────────────────────────────────────────┘     │
│  ┌── panel: run-3 (expanded) ──────────────────────────────┐     │
│  └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

- All run panels are **expanded by default** (per Q13). The state of any
  user-toggled panel is persisted in URL hash + localStorage so a refresh
  preserves it.
- Initial render strategy: `/api/experiments/<id>` returns the exp doc plus
  a *summary* row for each run (id, status, times, host, file count). The
  page renders immediately with skeleton bodies inside each run panel,
  then fires N concurrent `/api/runs/<run-id>` requests, populating each
  panel as it resolves. (Q21)
- Action bar at the experiment level: `Edit markdown` (opens the existing
  README editor on the exp doc), `Open Claude Code` (D15 below).
- Action bar inside each run panel: `Edit markdown` (opens the editor on
  *that run's* README), `Open Claude Code` (run-scoped preset prompt),
  `Archive` (writes `<run-dir>/.archived`).

The old `/p/<project>/r/<run-dir>` route returns a redirect to
`/p/<project>/e/<E-id-of-parent>?run=<run-dir>`, and the page
auto-scrolls/expands the named run panel on load.

### D14. Hypothesis cross-references

`docs/hypotheses.md` per-H entries gain an optional `Runs:` field:

```markdown
## H0003. zero-snr-improves-brightness
- **Statement**: …
- **Origin**: …
- **Status**: 🟡 PARTIAL
- **Experiments**: E0001-zero-snr-fix, E0004-rescale-cfg-mitigation
- **Runs**: zero-snr-260502-110000, zero-snr-cfg-260503-090000
- **Evidence**: …
- **Caveats**: …
- **Last verified**: 2026-05-04
```

The parser accepts both fields and disambiguates list elements by ID
format: `^E\d{4}-` matches an experiment ID, `^.+-\d{6}-\d{6}$` matches a
run dir name. A list element that matches neither surfaces a structured
warning and is dropped.

The frontend resolves `Runs` to clickable links that go to the run's
parent experiment page with the run panel expanded
(`/p/<project>/e/<exp-of-run>?run=<run-dir>`).

### D15. Open Claude Code preset prompts (hardcoded)

Both buttons open Claude Code at `<project-root>` (the repo root configured
in `config.yml`). They differ only in the preset prompt injected into the
opening session:

- **Run-scoped** (run panel button):
  ```
  I'm working on run `<run-dir>` inside experiment
  `<E-id-slug>`. The run README is at `logs/<run-dir>/README.md`,
  the experiment doc is at `docs/experiments/<E-id-slug>.md`.
  ```
- **Experiment-scoped** (exp page button):
  ```
  I'm working on experiment `<E-id-slug>`. The experiment doc is at
  `docs/experiments/<E-id-slug>.md`. It currently has <N> runs:
  - <run-1-dir>
  - <run-2-dir>
  ...
  ```

The exact text lives in a frontend constants module; we deliberately do
not make these configurable for v3.

### D16. CLI surface

New experiment subcommands:
- `memon experiment ls [--json]` — list experiments in the current project
- `memon experiment create <slug> [--title <…>] [--hypotheses H0001,H0003]
  [--from-run <run-dir>]` — allocates next E ID, writes the doc, optionally
  binds an existing run
- `memon experiment show <id-or-slug>` — print the parsed exp doc
- `memon experiment link <id> <run-dir>` — bidirectionally bind; warns if
  the soft prefix rule is violated; errors if the run already has a
  different `experiment:`
- `memon experiment unlink <id> <run-dir>` — bidirectional unlink
- `memon experiment delete <id> [--force]` — cascade-unlinks all runs
  (clearing each run's `experiment:`), then deletes the file. Without
  `--force`, prompts for confirmation listing the cascade impact.

New run subcommands:
- `memon run rename <run-id> <new-slug>` — only renames the slug; keeps
  the timestamp; checks slug uniqueness; updates the parent experiment's
  `runs[]` atomically.
- `memon run ls`, `memon run show`, `memon run journal read`,
  `memon run warning add/resolve/reopen/delete`, `memon run archive` —
  these are renames of the existing `memon experiment …` commands that
  operated on what we now call runs. Where the old name and the new name
  conflict (both `memon experiment add-warning` for runs and
  `memon experiment warning` for the new exp doc could exist), we always
  reserve `memon experiment …` for the new doc layer.

Legacy `memon experiment …` commands that referred to runs print a
deprecation message and dispatch to the run equivalent for one release;
this is implementation, not spec.

### D17. Migration v2 → v3

The migration is **agent-led** — there is no deterministic script that can
group runs by motivation/method similarity. The guide at
`packages/core/migrations/v2-to-v3.md` (authored per
`fs-migration-guide-authoring`'s seven-section rule) directs the agent
through:

1. **Survey** — list every run README; for each, extract the
   `Motivation` / `Method` / `Conclusion` / `Caveats` / `Warnings` sections
   plus relevant frontmatter (`hypotheses`, `tags`, `project`).
2. **Cluster** — agent groups runs by qualitative similarity of
   motivation+method, presents the proposed groupings to the user as a
   plain-text plan in the chat (e.g. "I propose 4 experiments: E0001 covers
   foo-260501 and foo-260502; E0002 covers …"). The agent allocates E IDs
   monotonically.
3. **Confirm** — user reads the proposed plan and either approves (`OK`,
   `proceed`, etc.) or asks for revisions. The agent loops 2→3 until the
   user approves. **No on-disk changes happen until the user approves.**
4. **Generate exp docs** — for each cluster, write
   `docs/experiments/E<NNNN>-<slug>.md` with merged motivation/method/
   conclusion/caveats/warnings (the warnings table preserves rowIds and
   gains a `Run` column populated with the source run dir). `created_at`
   is set to the earliest member run's `created_at`; `updated_at` is the
   migration time.
5. **Rewrite run READMEs** — for each migrated run:
   a. Strip the migrated body sections (Motivation/Method/Conclusion/
      Caveats/Warnings/New Hypotheses).
   b. Strip the `project:`, `hypotheses:`, and `tags:` frontmatter fields.
   c. Add `experiment: E<NNNN>-<slug>` and `updated_at: <migration-time>`
      to frontmatter.
6. **Verify bidirectional binding** — run a check script (the migration
   guide includes the bash) that, for every E doc, every entry in `runs[]`
   exists and has matching `experiment:` back-ref; for every run with
   `experiment:`, the named exp's `runs[]` contains it. Fail the migration
   on any inconsistency.
7. **Optional batch rename** — agent asks user "Do you want me to rename
   any runs so the experiment slug becomes a prefix of every run slug?
   This is a soft convention." On user approval, agent runs `memon run
   rename` for the proposed renames.
8. **Bump marker** — write `.memon/version.json` with
   `fs_convention_version: 3` and the current `last_migrated_at`.
9. **Single commit** with message `chore(memon): migrate FS convention v2 ->
   v3` (ASCII arrow, sentence case, no body). Per
   `fs-migration-runtime`'s per-step protocol.

**Pre-flight (handled by the existing migration runtime, not this guide):**
- working tree clean
- `memon install-skills --project-root <p>` runs first; this change keeps
  the existing v2 skill content but the runtime's pre-flight ensures the
  skills directory is present
- backup tarball is taken if not in git mode

**Rollback** mirrors v1→v2: `git revert HEAD` in git mode; extract the
backup tarball in non-git mode.

**Edge cases** the guide addresses:
- A run with no `Motivation`/`Method` content at all (e.g. a half-finished
  README): the agent still must place it in some experiment (single-run exp
  is fine), or surface it as a candidate orphan and ask the user.
- A run whose `Motivation` clearly forks two distinct lines of investigation
  (rare): the agent presents this to the user; the user may either pick one
  side or split into two new experiments. The agent does not "merge"
  conclusions silently.
- Pre-existing `docs/experiments/` directory with user files — abort with
  a named error and ask the user to relocate.

### D18. Spec rename approach

The existing `experiment-readme`, `experiment-discovery`, and
`experiment-edit` specs are *renamed in intent*: their content was about
runs (a `logs/<...>/` directory). After the rename:
- New capabilities `run-readme`, `run-discovery`, `run-edit` carry the
  run-side rules. Their contents are largely lifted from the old
  `experiment-*` specs, with terminology updated (`experiment` → `run`)
  and the run-specific tightening from this change (new `experiment:` and
  `updated_at` fields, removed `project:` / `hypotheses` / `tags`).
- `experiment-readme` / `experiment-discovery` / `experiment-edit` are
  **rewritten** to describe the new experiment doc layer. Their delta files
  remove every existing requirement and add the new requirements. This is
  unusual but explicit; the alternative — keeping the old name with
  unrelated semantics — would be more confusing.

After this change archives, the canonical `openspec/specs/` tree contains
six capabilities for the run/exp pair: three old names with new content,
three new names with the relocated old content.

### D19. Sub-project `project:` field handling

The parser stops reading the run frontmatter `project:` field. It is not an
error to have one; it is silently ignored (zero log output, no warning). The
migration guide instructs the agent to remove the field as part of step 5b.

If a project relied on the `project:` label as a meaningful sub-project
grouping, that information is lost on migration. The user explicitly
accepted this trade-off (Q18); the migration guide names the impact in its
edge-cases section so the user's agent can surface it before the rewrite.

### D20. Anomaly recompute trigger

The discovery layer's poll cycle (existing exponential-backoff polling)
already detects mtime changes on individual READMEs. After this change,
**any** mtime advance on either an experiment doc or a run README triggers
a re-evaluation of anomaly state for the affected experiment(s) — both the
exp directly named on the file and (for runs) the experiment listed in the
run's `experiment:` field, since mismatch detection requires looking at
both sides.

The anomaly set is held in the same in-memory index as everything else; the
`/api/anomalies` route returns a snapshot. SSE / live updates push anomaly
deltas to subscribed clients (`live-updates` capability is extended).

### D21. Skills out of scope (deferred)

The `memon-skills` capability is not modified by this change. The
`install-skills` code still writes the v2 skill files. The migration's
pre-flight ensures `.memon/skills/` exists; it does not check skill
content.

The follow-up change (call it `update-skills-for-experiment-system`)
will:
- Rewrite the write-script skill to first-create-experiment-then-create-run.
- Rewrite the run-exp skill to bind on creation.
- Add new skills for the `memon experiment …` and `memon run rename`
  flows.
- Bump the skill content version inside `.memon/skills/version.json` (a
  separate file from `.memon/version.json`).

This split was explicitly requested by the user (Q19) so the structural
work can land first and stabilize before the skill prompts are reworked.

### D22. Mock data fabrication policy

`mock/project-{a,b}/logs/*` already contains realistic-looking but
fictional runs. We will:
- Group the existing runs into experiments using best-effort interpretation
  of their motivations.
- Where the existing prose is too thin to support a coherent experiment
  story, we will *fabricate* additional motivation/method/conclusion text
  consistent with the run's existing setup/result.
- Add new tags/hypothesis links as needed for a richer demo.
- Strip the `project:` sub-project labels (no recovery; per D19).

The user explicitly authorized fabrication (Q11) since the mock dataset is
meant to demonstrate the system, not preserve real research history.

## Risks / Trade-offs

- **Spec wholesale-rewrite** → openspec's delta model is designed for
  additive changes, not full rewrites. We will lean on `## REMOVED
  Requirements` blocks in the deltas to make the rewrite explicit.
  Reviewer cost goes up; mitigation: design.md (this doc) is the readable
  narrative companion to the diffs.

- **Agent-led migration mis-clusters runs** → risk: the agent groups two
  runs into one experiment when they really represent distinct
  investigations. Mitigation: step 3 (user confirmation) is mandatory and
  blocking; the guide is clear that the agent must NOT proceed without
  approval. If the user notices a bad grouping post-migration, the
  experiments can be edited manually (move a run from E_a to E_b by
  rewriting two frontmatter fields).

- **Concurrent E ID allocation** → two `memon experiment create` runs at
  once could pick the same E ID. Mitigation: same as the `H` ID model
  today — single-user assumption holds; if violated, the second writer
  hits an EEXIST when creating the file and retries with `n+1`. We will
  spec a retry loop (max 5 attempts).

- **`/api/experiments` semantics flip is breaking** → external clients
  break. There are none. Documented in proposal.md.

- **Editor save handshake leaks `updated_at` ahead of save** → if the
  POST fails (network / 409), the editor's `updated_at` is now ahead of
  the disk's. Mitigation: on 409, the frontend rolls the editor's
  `updated_at` back to its pre-save value before showing the conflict UI.
  On network failure, the editor is dirty anyway and the user retries.

- **Skill content drift during migration window** → the v2 skill prompts
  reference the old single-file model; running them post-migration will
  produce v2-shaped READMEs. Mitigation: the migration guide names this
  explicitly so the agent steers users away from the v2-style flow until
  the follow-up skills change lands. Acceptable temporary state given the
  user's explicit choice (Q19).

- **`updated_at` defaulting to `created_at` on parse** can mask a real
  edit if a user hand-edits the file but forgets to bump `updated_at`.
  Mitigation: the web edit path always writes the field; CLI commands
  that mutate the doc body also write it. Hand-edit-without-bump is on
  the user; documented in the run-readme spec.

- **Lazy-load on the exp detail page introduces N round-trips** for an
  experiment with many runs. Mitigation: panels render with skeleton UI
  immediately, requests fan out concurrently, the experiment overview is
  fully interactive before the run details resolve. If real-world
  experiments grow past ~20 runs we revisit (probably batch-fetch).

## Migration Plan

This change *is* a migration. The deploy procedure for an existing memon
user looks like:

1. Update the memon CLI / web app to v3 (pull this PR).
2. Open the project in Claude Code.
3. Agent observes the version banner from `fs-migration-runtime`
   ("project at v2, runtime at v3") and proposes running
   `memon-migrate-fs`.
4. `memon-migrate-fs` invokes the v2→v3 guide (`packages/core/migrations/
   v2-to-v3.md`); the guide is read by the agent which runs steps 1–9
   from D17.
5. After the single migration commit lands, the user reopens the web
   dashboard and validates that:
   - Every run is now under some experiment (no orphan banner).
   - The yellow anomaly banner is empty (or contains only items the
     user understands).
   - The hypothesis page's `Runs` field still resolves correctly.

The runtime's existing rollback paths (git revert / tar-extract) remain
the recovery mechanism.

For developers working on this change *during* development:
- Mock data is migrated by hand as the first concrete deliverable so the
  parser/web work has v3 fixtures to test against.
- The migration guide can be hand-tested by snapshotting `mock/` to
  `mock-v2-snapshot/`, stripping it back to v2 layout, and walking the
  guide on the snapshot.

## Open Questions

None remaining at the proposal/design phase. The 23 design questions raised
during the propose discussion are pinned as Decisions D1–D23 above. Any new
question that surfaces during apply will be raised against this design and
resolved before code lands.
