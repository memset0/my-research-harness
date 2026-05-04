## Why

Today, an experiment's "which project does it belong to?" is decided by
its README front-matter `project:` field. `ExperimentIndex.list({ project })`
filters with `e.frontMatter.project === filter.project`
(`packages/core/src/discovery/index.ts:50`). That conflicts with how users
actually organize work.

Concrete failure: the `sparse-fsdp` workspace contains 71 experiment
directories spread across 4 recipes. The recipes share one
top-level `HYPOTHESES.md` and `JOURNAL.md`, so it's natural to configure
`sparse-fsdp` as a single memon project. But each README's
front-matter declares `project: <recipe-name>` (e.g. `predictive-skip-validation`,
`justrl-with-verl`) because the recipe is the meaningful unit when you're
inside an individual experiment. With today's logic,
`/api/experiments?project=sparse-fsdp` returns 0 results — every
experiment "belongs to" some recipe that doesn't match the configured
project name.

The system already knows which `config.yml` project owns a given experiment
directory: `discoverExperiments(project)` is called per-project, the loop
in `runtime.ts:159-177` already passes `project.name` into
`readExperimentDir(dir, project.name)`. The information just isn't stored
on the resulting `Experiment` object — it lives only in
`frontMatter.project`, which is user-controlled and used for a different
purpose.

The fix: project membership is **structural** (config + filesystem layout),
not **declarative** (frontmatter). `frontMatter.project` becomes a free-form
**sub-project** label — useful for grouping/filtering inside one project's
view, surfaced in the UI as a small tag/badge, but never the source of
truth for membership.

## What Changes

- **`Experiment` interface gains a top-level `project: string` field.**
  Set by `readExperimentDir(dir, projectName)` from the projectName
  argument. Always populated; equals the `name` of the project (from
  `config.yml`) whose `discoverExperiments` call surfaced this directory.
- **`ExperimentIndex.list({ project })` filters by the new top-level
  `project`**, not by `frontMatter.project`.
- **`frontMatter.project` becomes optional** in the spec. Parsers SHALL
  no longer warn when it's omitted. The backfill at
  `read.ts:46-47` (`if (parsed.frontMatter.project === '')
  parsed.frontMatter.project = projectName`) is **removed** — the field is
  preserved verbatim from the source so the UI can display the user's
  declared sub-project label even when it differs from the config project
  name.
- **Search behaviour**: free-text experiment search SHALL match against
  the new top-level `project` (so `memon search sparse-fsdp` still finds
  things) AND against `frontMatter.project` as a sub-project haystack.
- **CLI `memon list --project <name>`** filters by the new top-level
  `project` (config-derived), not by `frontMatter.project`. Behaviour
  identical for the common case where the two agree; correct for the
  sparse-fsdp case where they don't.
- **CLI `memon new <name>`** keeps writing `project: <projectName>` into
  the scaffolded README's frontmatter as a default sub-project label.
  Users are free to change it to a finer-grained recipe name later.
- **Web experiment list view**: experiments in the same memon project but
  with different `frontMatter.project` values SHALL be visually grouped
  or labelled by sub-project. Minimum bar: a small badge/tag column
  showing the sub-project (omitted when blank or equal to the project
  name). Stretch: optional client-side group-by-sub-project toggle.
- **Web experiment detail**: front matter panel SHALL label the
  `project` field as "Sub-project" when it is set and differs from the
  enclosing memon project name (and "Project" otherwise). Removes the
  ambiguity in the current label.
- **Spec deltas** in: `experiment-discovery` (index field semantics),
  `experiment-readme` (front-matter field becomes optional + redefined),
  `memon-cli` (`--project` filter source-of-truth), `web-dashboard` (UI
  treatment).

## Capabilities

### New Capabilities

(none — this is a behaviour change in existing capabilities)

### Modified Capabilities

- `experiment-discovery`: Change which field on the indexed Experiment
  carries project membership and how `list({ project })` filters.
- `experiment-readme`: Reclassify the `project:` front-matter field as
  optional + informational sub-project label.
- `memon-cli`: Restate the `--project` filter source-of-truth.
- `web-dashboard`: Sub-project label/tag in list and detail views.

## Impact

- **Code:** `packages/core/src/types.ts` (Experiment interface),
  `packages/core/src/discovery/read.ts` (set top-level `project`,
  drop frontmatter backfill), `packages/core/src/discovery/index.ts`
  (`list` filter, `search` haystacks), `packages/cli/...` (any place
  that filters by frontmatter.project), `apps/web/lib/api.ts` (extend
  `IndexedExperiment` / `FullExperiment` types), `apps/web/lib/server/
  data.ts` (surface the new field in API payloads), `apps/web/components/
  experiment-list.tsx` and `experiment-detail.tsx` (sub-project UI).
- **Data:** zero migration. Existing READMEs continue to work; the
  semantic shift is in *how* `frontMatter.project` is interpreted, not
  in the bytes on disk.
- **Tests:** `packages/core` discovery + read tests need updates to
  exercise the new top-level field and the relaxed required-fields list.
  Web/CLI tests exercising `--project` filter or list views need a
  fixture pass.
- **Mock data:** `mock/project-a` and `mock/project-b` likely have
  `project: project-a` / `project: project-b` matching today; under the
  new rules they continue to render correctly (the top-level project
  is set from config, the frontmatter value matches and would be hidden
  by the "omit when equal" UI rule). No mock edits required by the
  semantic change itself, but tests that asserted "filter by
  frontmatter.project" must be updated.
- **User-visible impact (immediate):** sparse-fsdp page goes from "no
  experiments" to "71 experiments grouped/tagged by recipe". project-a/b
  unchanged in appearance.
- **Backward compatibility:** existing `config.yml` and existing READMEs
  are unaffected. There is no breaking surface — only behaviour
  alignment with what config has always implicitly declared.
- **Out of scope:** introducing an explicit "sub-project" key in
  `config.yml` (e.g. nested project definitions). For now sub-projects
  are ad-hoc, declared per-experiment in front matter; we revisit if
  users want to lock down the set or attach per-sub-project metadata.
