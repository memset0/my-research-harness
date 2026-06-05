## Why

The shipped `add-code-review-docs` change gave the dashboard a runtime + viewer
for code-review docs, but nothing teaches agents how to AUTHOR them. Left to
improvise, agents produce inconsistent frontmatter (the machine-read contract
the viewer depends on), branch-pinned or wrong GitHub links, and free-form
bodies that don't map to the viewer's commit checklist / todolist / sections.
This change adds the agent skill that makes authored docs conform to the format
the runtime already parses and renders.

## What Changes

- **New skill `packages/skills/memon-write-code-review/SKILL.md`** (model-invocable;
  English body, Chinese only in `>` user-dialogue quotes). It documents end to end:
  - **Naming + scope**: `docs/code-review/<YYYY-MM-DD>-<slug>.md` (project-wide)
    vs `docs/experiments/E<NNNN>-<slug>/code-review/<YYYY-MM-DD>-<slug>.md`
    (experiment-scoped); one doc per session / large change.
  - **Frontmatter contract**: `title`, `description`, `experiment`,
    `created_at` / `updated_at` (ISO8601+offset), `commits[]`
    (`repo`, `sha`, `url`, `subject?`, `reviewed`), `review_todolist[]`
    (`item`, `done`). Completion is derived; the agent writes every flag `false`.
  - **GitHub URL recipe** (submodule-aware): resolve each repo's remote (main +
    each submodule), ssh→https, assemble `/commit/<sha>` and
    `blob/<sha>/<path>#L<a>-L<b>` permalinks with per-repo owner/sha and a path
    relative to the owning repo's root.
  - **Body template**: `## Requirement`, `## Changes`, `## Verification`,
    `## Notes`; each change titled Conventional-Commits style with five H4
    subsections (Deliverables, Design Decisions, Analysis, Verification, Details).
    Minimal inline snippets + permalinks; deep "why" (root cause + math in
    `$…$` / `$$…$$`); pseudocode labeled by a preceding sentence.
  - **AskUserQuestion** when change-split granularity is ambiguous; the
    "sections are angles to consider, not a rigid template" philosophy.
  - A preflight pointer to `../PREFLIGHT.md`.
- **`packages/skills/README.md`**: add the skill to the selection matrix + the
  files-written table.
- **`packages/skills/PREFLIGHT.md`**: add the skill to the preflight-using list.
- **`packages/skills/memon-drive/SKILL.md`**: list `memon-write-code-review`
  among the orchestrator's sub-tools and, after a Plan item that landed a
  non-trivial code change completes, proactively ask the user whether to
  generate a code-review (hand off to the new skill, scoped to the experiment).
- **Completion notification**: `memon-write-code-review` ends by pushing a
  `memon notify` (the `memon-notify` skill) with a `[code-review]`-prefixed
  title (severity `done`) so the user learns a review is ready — best-effort,
  after the doc is written.
- **No runtime code**: `memon install-skills` auto-discovers `memon-*` dirs, so
  the new skill is bundled + synced automatically.

## Capabilities

### Modified Capabilities

- `memon-skills`: add a requirement establishing the `memon-write-code-review`
  skill, its model-invocable policy, and the authoring conventions it documents.

## Impact

- **Docs/skills:** `packages/skills/memon-write-code-review/SKILL.md` (new),
  `packages/skills/README.md`, `packages/skills/PREFLIGHT.md`.
- **Specs:** `memon-skills` (modified).
- **Runtime/code:** none — `install-skills` auto-bundles the new dir.
- **Depends on:** the shipped `code-review-store` / `code-review-viewer`
  capabilities (the skill authors to the exact frontmatter + body they parse).
- **Out of scope:** a `memon` CLI helper to build GitHub URLs / allocate the
  next doc (the skill uses a raw-git recipe; a CLI helper would be a separate
  runtime change).
