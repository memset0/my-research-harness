## Context

A v3 experiment doc currently has five canonical H2 body sections:
`Motivation`, `Method`, `Conclusion`, `Caveats`, `Warnings` (see
`openspec/specs/experiment-readme/spec.md` → "Experiment doc body
sections"). The doc is the orchestrator across one or more member
runs. Multi-run experiments commonly need iterative planning ("try LR
3e-4 next", "sweep batch size") and per-iteration reflection ("warmup
helped", "loss diverged at step 8k"), but the existing five sections
have no good home for that.

Today the agent (and human) workflows have drifted in two unhealthy
ways to compensate:

1. Per-run "what we just learned" gets stuffed into `## Conclusion`,
   sometimes prematurely — the agent fabricates a conclusion because
   the section *should* have something, even when no defensible
   conclusion exists yet.
2. Forward-looking TODOs get written into `## Method`, polluting what
   should be a stable methodology reference.

Both are observable in the existing exp docs. Adding a sanctioned
working area — `## Plan` — gives the agent an explicit place to put
both the to-do list and the per-item reflections, and lets the user
glance at any exp doc to see "what's the agent planning, and what
have we actually checked off so far."

The web markdown renderer at `apps/web/components/markdown.tsx`
already enables `remark-gfm`, which natively handles GFM task lists
(`- [ ]` / `- [x]`) at any nesting level and renders them as disabled
`<input type="checkbox">` — so v1 read-only checkbox rendering is
mostly a "verify and style" job, not a build-from-scratch job.

## Goals / Non-Goals

**Goals:**

- Add `## Plan` as the 6th canonical H2 body section in the v3
  experiment doc, ordered between `Method` and `Conclusion`.
- Parser preserves `Plan` body verbatim on the experiment record (no
  structured per-task field — just a `plan: string | null` slot
  alongside the other section bodies).
- Serializer emits `## Plan` in the canonical position whenever an
  exp doc is round-tripped, even if its body is empty (placeholder,
  consistent with how other empty sections are emitted today).
- Web exp detail page renders `Plan` body as markdown, with GFM task
  list checkboxes visible at every nesting depth, read-only.
- Edits to `Plan` go through the existing `Edit markdown` dialog →
  `PUT /api/experiments/:id/readme` path. No new API.
- Parser does NOT emit a `LEGACY_*` warning for docs that lack a
  `Plan` section — absence is fine, same as other body sections.
- Test coverage: parse+serialize round-trip with nested task lists,
  and a web render test for nested checkbox display.

**Non-Goals:**

- Interactive checkboxes (click-to-toggle that PATCH-es the file).
  Deferred to a possible v2; v1 is read-only.
- A structured task model in the parser (per-task ID, completion %,
  etc.). The body is opaque markdown; `remark-gfm` handles rendering.
- A `Plan` section on RUN READMEs. Plan lives at the experiment level,
  because per-run plans are fragmented and the value of Plan is
  cross-run coordination. (A run that needs a TODO list can still use
  bullets in its `Setup` / `Result` sections.)
- Auto-marking the experiment FINISHED when all Plan checkboxes are
  ticked. The agent SHOULD use Plan completion as a *signal* to
  consider transitioning, but the actual decision still requires
  member-run statuses + a real Conclusion. (Encoded as a follow-up
  for the skills update, not as runtime behavior.)
- CLI subcommands for editing the Plan section (e.g. no
  `memon experiment plan add`). Plan content is edited via the web
  Edit markdown dialog or by editing the file directly.
- Skills file (`.claude/skills/*.md`) updates. Captured here as a
  follow-up so the next skills change picks them up; not bundled
  into this change.

## Decisions

### D1. Section name: `Plan`

Considered: `Plan`, `Progress`, `Roadmap`, `Tasks`, `Checklist`,
`Worklog`. Picked `Plan` because:

- Single noun, matches the existing 5 sections' style.
- The user explicitly described the intent as "plan and progress" —
  "Plan" is the directly named anchor.
- Reflections fit naturally as nested bullets / sub-paragraphs under
  each task; no need for a separate `## Reflections` section.
- `Tasks` would conflict semantically with this repo's OpenSpec
  `tasks.md` workflow. `Status` would conflict with the run status
  enum (`PENDING`/`RUNNING`/...).
- "Plan" maps to the GitHub project board / PR description "plan
  with checkboxes" idiom that agents already know how to write.

### D2. Section position: between `Method` and `Conclusion`

Resulting order: `Motivation` → `Method` → `Plan` → `Conclusion` →
`Caveats` → `Warnings`.

Rationale: the natural reading flow is *why* (Motivation) → *how*
(Method) → *what we're doing about it* (Plan, the live work area) →
*what we found* (Conclusion) → *what to be careful about* (Caveats)
→ *cross-cutting alerts* (Warnings). Putting Plan immediately after
Method also reinforces "Method = stable methodology, Plan = live
TODOs" — the boundary is visually adjacent so it's harder to drift.

Alternative considered: putting Plan first (before Motivation) as a
dashboard-style status header. Rejected — interrupts the doc's
narrative arc and competes with the page-level header that already
shows aggregate status.

### D3. Plan body is opaque markdown; no structured task model

The parser SHALL store `plan: string | null` on `ExperimentSections`
just like `motivation` / `method` / `conclusion` / `caveats`. No
attempt to extract individual `- [ ]` items into a structured array.

Rationale:

- GFM task lists are not the only content allowed in Plan —
  free-form paragraphs, plain bullets, sub-headings, and reflection
  notes are all permitted alongside checkboxes.
- Rendering with `remark-gfm` already produces correct nested
  checkboxes; no extra parsing needed for v1.
- If a future iteration needs per-task progress aggregation
  ("3 of 5 done"), a derived parser can run on the opaque body
  without changing the storage shape.

### D4. Read-only checkboxes in v1

`react-markdown` + `remark-gfm` renders `- [x]` / `- [ ]` as
`<input type="checkbox" checked disabled>` / `<input type="checkbox" disabled>`
by default. We keep `disabled` in v1.

Rationale (vs. interactive):

- Interactive toggling requires: parse the markdown to find the
  exact `[ ]`/`[x]` byte offsets for the clicked item, mtime-locked
  PATCH to the backend, server re-serialization, SSE invalidation,
  optimistic UI rollback on conflict — at least 5x the engineering
  effort of read-only.
- The "Edit markdown" dialog is already wired up, mtime-safe, and
  one click away. For a v1 the round-trip "open editor → flip
  checkbox in markdown source → save" is acceptable friction.
- Once the section exists and gets adopted, we can measure how often
  the user wants to toggle directly and decide if interactive is
  worth the spend.

### D5. Nesting: any depth, native GFM behavior

Nested checkboxes are produced by indenting list items per GFM (2 or
4 spaces under the parent `- `). Each nested item MAY independently
carry `[ ]` or `[x]`. The renderer relies on `remark-gfm`'s default
behavior; no custom AST walker.

Rationale: matching GFM exactly means the source markdown looks
identical to what GitHub renders, which is what the user and the
agent already understand.

### D6. Non-canonical-section warning unchanged

The parser already emits `WARNING: unknown section "X"` for any H2
not in the standard set. After this change, `Plan` becomes part of
the standard set, so no warning is emitted for it. Docs that don't
have `Plan` produce no warning either (same tolerance the other body
sections enjoy).

### D7. No FS_CONVENTION_VERSION bump

Adding an optional body section is additive: existing exp docs
without `## Plan` still parse cleanly, and writers introduce the
empty placeholder on next round-trip without changing semantics for
any other field. `FS_CONVENTION_VERSION` stays at 3.

### D8. SSE topic: piggyback on `experiment-change`

Plan edits go through `PUT /api/experiments/:id/readme`, which already
fires the `experiment-change` SSE topic and bumps `updated_at`. No
new topic, no new payload field.

### D9. Where the v1 styling lives

Tailwind's `prose` plugin (already wired into `Markdown`) styles
checkboxes reasonably out of the box, but two cosmetic touches will
likely be needed:

- Make the disabled checkbox look obviously disabled (cursor +
  reduced opacity) so users learn quickly that the source-edit path
  is the way to toggle.
- Ensure nested checkbox lists keep the bullet's hanging indent
  visually aligned (test with 3-level nesting).

These ride inside `apps/web/components/markdown.tsx`'s `cn()`
utility classes; no new component file.

## Risks / Trade-offs

- **[Risk] Agent confusion: where does each kind of content go?**
  → Mitigation: skills follow-up explicitly states "Plan = live TODOs +
  per-run reflections; Method = stable methodology; Conclusion =
  defensible findings only." Without that update, agents may keep
  drifting. Tracked as a follow-up in the proposal so the next
  skills change picks it up.
- **[Risk] Empty `## Plan` placeholder confuses users into thinking
  the section is required.**
  → Mitigation: render the empty section like other empty sections
  today (existing "to fill" placeholder treatment in
  `experiment-readme` / `experiment-page.tsx` covers this). No
  extra UI.
- **[Risk] Read-only checkboxes feel like a regression vs. GitHub.**
  → Mitigation: documented as v1 scope. Clicking "Edit markdown"
  opens the source one click away. Revisit if usage data shows the
  toggle path is the dominant interaction.
- **[Trade-off] Plan body is opaque.** No "X of Y done" aggregation
  in the experiment list/grid in v1. Acceptable: the user wants per-
  experiment context, not a portfolio rollup. Aggregation is easy to
  add later because the body is just markdown.
- **[Risk] `remark-gfm` task list rendering is theoretical until
  verified end-to-end.**
  → Mitigation: tasks.md includes a verification step that fetches
  the rendered markup (per CLAUDE.md F1) and confirms a `<input
  type="checkbox">` shows up at multiple nesting depths.

## Migration Plan

1. Land parser/serializer/types changes in `packages/core` with a
   round-trip unit test.
2. Land web rendering in `apps/web` (verify checkbox rendering,
   add `Plan` Card to the exp detail page).
3. Existing exp docs without `## Plan` keep parsing cleanly. The
   first time any of them is saved through the web Edit markdown
   dialog, the serializer will round-trip-add an empty `## Plan`
   placeholder. No batch migration script needed.
4. No rollback hazard: changes are additive at every layer.

## Open Questions

- Should the empty `## Plan` placeholder render with a hint text
  like "no plan yet — open Edit markdown to add tasks", or stay
  blank like other empty sections? Default to the existing empty-
  section treatment for consistency, revisit if users ask.
- Should we surface a Plan-completion signal somewhere in the exp
  list/grid (e.g. "3/5 tasks done")? Out of scope for v1 — the body
  is opaque. Trivial to add later by counting `[x]` vs `[ ]` in the
  body string.

## Follow-ups (out of scope for this change)

These are recorded so the next skills update or feature change picks
them up; they are explicitly NOT tracked in this change's tasks.md.

- **Skills update** (`.claude/skills/*.md`):
  - Tell the agent: `Plan` is the canonical place for forward-looking
    TODOs and per-run reflections.
  - Tell the agent: `Method` SHOULD describe methodology only — do not
    write "next step: try X" lines into Method.
  - Tell the agent: `Conclusion` SHOULD remain empty (or carry an
    explicit "pending" note) until a defensible conclusion can be
    stated. Per-run learnings go into `Plan` as reflections beside
    the relevant task; promote them to `Conclusion` only when the
    cross-run pattern is clear.
  - Tell the agent: when all `Plan` checkboxes are completed,
    consider whether the experiment is ready to be marked finished
    (requires member-run statuses being terminal AND a real
    Conclusion); checking off the last task is a *signal*, not an
    auto-promote.
- **Possible v2 — interactive checkboxes**: consider a click-to-toggle
  PATCH path if usage data shows the current "open editor → save"
  loop is heavily used.
- **Possible v2 — Plan completion in exp grid**: surface "X/Y done"
  on exp cards if users ask.
