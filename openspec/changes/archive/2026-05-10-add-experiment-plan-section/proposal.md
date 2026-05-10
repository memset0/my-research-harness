## Why

A v3 experiment doc currently has no living workspace for tracking what
the experiment is *trying to do next* and what each completed run
*taught us*. An experiment routinely needs several non-identical runs
before a conclusion is possible, and right now agents have nowhere
canonical to write down "next thing to try" / "what the last run
told us" — so two failure modes have set in:

1. **Process leaks into Conclusion.** Without a working area, agents
   stuff per-run learnings into `## Conclusion`. Worse, they sometimes
   fabricate a conclusion when none can yet be drawn — because the
   section nominally needs *something*.
2. **TODOs leak into Method.** Agents write "next try X" / "todo: sweep
   Y" lines into `## Method`, polluting what should be a stable
   methodology description with mid-flight task lists.

Both failure modes silently degrade the value of the doc: `Conclusion`
gets noisier and less trustworthy, `Method` stops being the
methodology reference it's meant to be. The user also can't quickly
glance at an experiment doc and see "where are we right now."

A dedicated `## Plan` section — supporting GitHub-flavored markdown
task list syntax (`* [ ]` / `* [x]`) at any nesting depth, with
free-form reflections allowed alongside each item — gives the agent a
sanctioned home for both planning and reflection, lets the user see
progress at a glance, and protects `Method` and `Conclusion` from
contamination.

## What Changes

- **Add `## Plan` H2 section** to the canonical experiment doc body
  section list, ordered between `Method` and `Conclusion`.
  Resulting order: `Motivation` → `Method` → `Plan` → `Conclusion`
  → `Caveats` → `Warnings`.
- **Plan section semantics**: free-form markdown body. SHOULD primarily
  contain GFM task list items (`- [ ]` / `- [x]`, optionally `* [ ]` /
  `* [x]`). Nested lists at any depth are allowed and each child item
  MAY independently carry a checkbox. Non-checkbox content (paragraphs,
  bullets without checkboxes, sub-bullets serving as reflections) is
  permitted and preserved verbatim.
- **Parser** (`packages/core`): treat `## Plan` like other body
  sections — preserve the body text on the experiment record, no
  structured field for individual tasks at this stage. Missing /
  empty `## Plan` is non-erroring (same tolerance as other body
  sections).
- **Serializer** (`packages/core`): when (re)writing an experiment doc,
  emit `## Plan` in the canonical position, even if empty (placeholder
  consistent with other empty body sections).
- **Web rendering** (`apps/web`): the `## Plan` section body is
  rendered via the existing markdown renderer with **GFM task list
  rendering enabled at every nesting level**. Rendered checkboxes are
  **read-only in v1** — clicking does nothing; toggling state is done
  via the existing "Edit markdown" dialog (same as today's body
  edits). No new endpoint, no optimistic checkbox PATCH.
- **No CLI subcommand** in this change. Plan content is edited via the
  existing markdown edit path (`PUT /api/experiments/:id/readme` from
  the web, or directly editing the file on disk).
- **Skills follow-up notes (out of scope for this change's code, but
  recorded here so the next skills update lands them)**:
  - `Method` SHOULD describe methodology only; mid-experiment TODOs
    belong in `Plan`.
  - `Conclusion` SHOULD remain empty (or carry a "pending" note) until
    a defensible conclusion can actually be stated; per-run
    observations go in `Plan` as reflections beside the relevant task.
  - When all `Plan` checkboxes are checked, the agent SHOULD consider
    whether the experiment is ready to be marked finished
    (member-run statuses + Conclusion both required) — completion
    of Plan items is a *signal*, not an automatic state transition.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `experiment-readme`: add `Plan` to the canonical H2 body section
  list and define its task-list semantics + writer behavior.
- `experiment-edit`: confirm the existing `PUT /api/experiments/:id/readme`
  path is the v1 channel for `Plan` edits (no new endpoint); document
  that Plan content round-trips verbatim.
- `web-dashboard`: experiment detail page renders the `Plan` section
  with GFM task lists (read-only checkboxes) at any nesting depth.

## Impact

- **Specs**: deltas to `experiment-readme`, `experiment-edit`,
  `web-dashboard`.
- **Code — `packages/core`**: extend the canonical body-section list /
  parser / serializer to know about `Plan`; add a focused unit test
  for round-tripping a Plan section with nested task lists.
- **Code — `apps/web`**: the markdown rendering pipeline used by the
  experiment detail page must enable GFM task list rendering at all
  nesting levels (likely already on via `remark-gfm`; verify and add
  test). Confirm checkboxes render disabled (not interactive). No
  new API routes.
- **Code — `packages/cli`**: no surface change; `memon experiment show`
  prints whatever section is in the file, including `Plan`.
- **Migration**: no on-disk format break. Existing experiment docs
  without `## Plan` keep working (parser tolerates the absence, same
  as today for other body sections). The next write of an experiment
  doc by the canonical serializer will introduce an empty `## Plan`
  placeholder in the canonical position.
- **`FS_CONVENTION_VERSION`**: unchanged. Adding an optional body
  section is additive and not a breaking schema change.
- **Skills (`.claude/skills/*.md`)**: NOT modified in this change.
  The follow-up note above is the spec the next skills-update change
  should pick up. Filed as a follow-up rather than bundled here so
  this change stays scoped to the doc-section + rendering work.
