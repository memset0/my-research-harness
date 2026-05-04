## Context

`packages/core` defines `Experiment` (`packages/core/src/types.ts`) as the
canonical experiment record. Today its only "project" knowledge is via
`frontMatter.project` (a string the user writes in the README front matter).
`ExperimentIndex.list({ project })` filters by that field. Web and CLI
consumers all delegate to that filter.

Discovery is structurally project-aware: `runtime.ts` loops over
`config.projects`, calls `discoverExperiments(project)` for each, then
feeds every found directory into `readExperimentDir(dir, project.name)`.
The `project.name` is in scope at indexing time but never makes it onto
the resulting `Experiment` — it's silently dropped.

That gap is the bug. As soon as `frontMatter.project` is allowed to mean
something the user cares about (sub-project / recipe / experiment family),
the structural mapping of "which config project owns this dir" must be
explicit somewhere, and the obvious place is on the `Experiment` itself.

## Goals / Non-Goals

**Goals:**

- Make project ownership a property of *where the dir was discovered*
  (i.e., which `config.yml` project's `root` contained it), surfaced as a
  required top-level field on every `Experiment`.
- Free `frontMatter.project` to be a free-form sub-project label without
  affecting filtering correctness.
- Surface the sub-project in the UI when it adds information (i.e., when
  it differs from the enclosing project's name).
- Land with **zero data migration** — every existing README on disk
  continues to work, only the *interpretation* of `frontMatter.project`
  shifts.

**Non-Goals:**

- Introducing first-class sub-project objects in `config.yml`. Sub-projects
  remain ad-hoc, user-declared via front matter.
- Adding a per-sub-project `HYPOTHESES.md` / `JOURNAL.md`. Those still
  live at the configured project root.
- Renaming `frontMatter.project` on disk (e.g. to `subproject:`). The
  field name stays; only its meaning is restated.
- Cross-project ownership — an experiment dir can still only belong to
  one config project (the first one whose `discoverExperiments` returns
  it; in practice there's no overlap because roots are disjoint).

## Decisions

### D1. Add `project: string` as a top-level field on `Experiment`

Alternative considered: keep ownership purely implicit (look up by
matching path-prefix against `config.projects` at filter time). Rejected
because (a) every `list({ project })` call would re-scan config; (b) the
information is already known at discovery time, not storing it is wasteful;
(c) explicit fields are easier to debug than recomputed ones.

The field is **always populated** (non-empty string). Set in
`readExperimentDir(dir, projectName)` from the `projectName` argument.
The signature stays the same; we just keep the value instead of dropping
it after the front-matter backfill.

### D2. Drop the front-matter backfill in `readExperimentDir`

Today, `read.ts:47` does:

```ts
if (parsed.frontMatter.project === '') parsed.frontMatter.project = projectName
```

This was load-bearing while `frontMatter.project` was the source of truth.
With ownership on the top-level field, the backfill becomes harmful — it
hides whether the user actually wrote a sub-project label. We drop it.
Empty `frontMatter.project` stays empty; downstream UI uses "" as the
"no sub-project label" signal.

### D3. `ExperimentIndex.list({ project })` filters on the top-level field

```ts
const filtered = filter.project
  ? all.filter((e) => e.project === filter.project)
  : all
```

Strict equality. No fallback to `frontMatter.project`. (For the historical
case where they agreed, the new logic returns the same set; for sparse-fsdp,
it returns 71 instead of 0.)

### D4. Search treats top-level `project` and `frontMatter.project` as separate haystacks

`matchesQuery` currently haystacks `frontMatter.project`. Add a haystack
for the new top-level `project`. Keep the front-matter one too — searches
for the recipe name (`predictive-skip-validation`) should still find runs
even though that string is not the membership project. Both haystacks use
the same `haystackContains` helper.

### D5. CLI `--project <name>` filters on the top-level field

`memon list --project <name>` is the user-visible knob. With D3 it
naturally targets the new top-level field. Tests that asserted "filter
by frontmatter.project" need to be re-asserted in the new model. Mock
data unchanged.

### D6. Web UI: surface sub-project as a tag, label appropriately on detail page

Two UI changes:

1. `experiment-list.tsx`: experiment row gets a small tag/badge column
   showing the sub-project. Render rule: show the badge only when
   `e.frontMatter.project` is non-empty AND differs from `e.project`. If
   blank or equal, show nothing (avoids noise on project-a/b which have
   matching values today).
2. `experiment-detail.tsx`: in the front-matter panel, label the row
   `project` as "Sub-project" when it's set and differs from the enclosing
   project, otherwise keep "Project" (or omit when equal — same dedup rule
   as the list).

The sidebar grouping by sub-project is **not** in this change. It's a
worthwhile follow-up but adds complexity (collapsible groups, per-recipe
navigation, etc.) that's orthogonal to fixing the filter.

### D7. `frontMatter.project` becomes OPTIONAL, parser stops warning on its absence

The `experiment-readme` spec lists `project` as a required front-matter
field today. We move it to optional. The parser's missing-required-field
warning at parse time SHALL no longer fire for `project`. Other required
fields (`id`, `name`, `status`, `created_at`, `entry`, `command`,
`hypotheses`, `tags`) are unchanged.

`memon new` continues to scaffold a `project: <projectName>` line in the
template. That's now a default sub-project hint, not a constraint.

## Risks / Trade-offs

- **Risk:** users who depended on the old filter-by-frontmatter behavior
  to "tag" experiments across projects (i.e., `frontmatter.project: foo`
  to make this run show up under `foo` even though it lives under `bar/`)
  see a behaviour shift. → **Mitigation:** unlikely use case (the
  filesystem layout was always primary in practice, and nothing in the
  current spec encouraged the cross-project-tagging hack). Document the
  change clearly in the proposal so a migration note is on hand if anyone
  surfaces.
- **Risk:** parser tests asserting on the "missing required field"
  warning for `project:` will fail. → **Mitigation:** explicit task to
  update those (it's <5 tests in core).
- **Risk:** mock data has `frontMatter.project: project-a` matching the
  top-level `project: project-a` from config. With D6's "hide sub-project
  badge when equal", project-a/b dashboards look identical to today —
  but if a future test relies on the badge being shown, that test could
  silently fail. → **Mitigation:** explicit dedup rule documented in spec
  + UI helper, and a smoke test for the "differs → shown" case using a
  sparse-fsdp-shaped fixture.
- **Trade-off:** explicit top-level `project` adds a field to one of the
  hottest types in the codebase. Every consumer of `Experiment` sees it.
  Acceptable: the field is small (single string), always set, and removes
  ambiguity that was costing us correctness.
- **Migration cost:** zero on disk. Code-side: one field added, one
  filter changed, one backfill removed, plus UI tweaks. Total LOC small.
- **Rollback:** revert this change in one commit. No data migration to
  undo. The filter goes back to checking `frontMatter.project` and
  sparse-fsdp returns to "0 experiments shown" — the bug we started
  with — but no other regression.

## Migration Plan

1. Land the core changes (`Experiment` field + `read.ts` set/drop-backfill
   + `index.ts` filter + search haystacks). Existing core tests fail
   loudly where assumptions need updating; fix them together.
2. Land the API/web changes (`api.ts` types, `data.ts` payload shape, UI
   tag/badge, detail-page label). UI smoke test against project-a (no
   visible change) and sparse-fsdp (71 experiments visible, recipe badges
   shown).
3. Land the CLI changes (`--project` filter, any internal use of
   `frontMatter.project` as filter key). Re-run CLI test suite.
4. Update spec deltas in `experiment-discovery`, `experiment-readme`,
   `memon-cli`, `web-dashboard`. Run `openspec validate` clean.

Each step's tests guard the next. No big-bang merge.

## Open Questions

1. Should the sub-project be displayed as a column header, an inline
   badge, or both? Defer to UI implementation; minimum bar is "user can
   tell which sub-project an experiment is from at a glance in the list
   view." Polish in a follow-up if needed.
2. Should the sidebar collapse experiments by sub-project? Worth doing
   eventually; out of scope here. Tracked as a follow-up.
3. Should we add `--subproject <name>` to `memon list`? Not in this
   change. If/when sub-project becomes a first-class config concept,
   revisit.
