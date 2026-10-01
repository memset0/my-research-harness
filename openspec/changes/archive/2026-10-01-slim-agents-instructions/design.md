## Context

See proposal.md for motivation. Constraints that shape the approach:

- `CLAUDE.md` is a relative symlink to `AGENTS.md` and must stay that way; only `AGENTS.md` content changes.
- Canonical specs reference the file: `fs-migration-guide-authoring` requires a sentence naming `openspec/specs/fs-migration-guide-authoring/spec.md`; `git-status` cites rule "F4". Both anchors must survive.
- A concurrent change (`restore-local-gates-and-backend-cleanup`) removes Backend daemon/distribution/update modules and adds a root `prepare` hook installer. The rewritten file describes the post-change state.
- OpenSpec 1.11 `openspec/config.yaml` accepts `context` (≤50KB, injected into artifact instructions) and per-artifact `rules`.
- Tracked files must not contain operator-specific hosts, paths or project names.

## Goals / Non-Goals

**Goals:**
- Every fact stated in `AGENTS.md` is verified against the current source before it is written.
- Rules become imperative and checkable (rule + verification command where one exists).
- Snapshot-style enumerations are replaced by pointers to the file that is the source of truth.
- Every repository-specific OpenSpec/Git/release rule is retained.

**Non-Goals:**
- Changing code, specs, skills, `openspec/config.yaml`, or the symlink.
- Fixing the drift in canonical specs identified by the audit.
- Adding rules that the current file does not already carry (factual corrections excepted).

## Decisions

1. **Generic workflow text goes to `openspec/WORKFLOW.md`, not `openspec/config.yaml` `context`.** `context` is only injected into artifact instructions once a workflow is already running, while routing rules (which workflow to pick, the development entry gate) must be read before any workflow is chosen, including apply/archive and plain Git operations. A plain Markdown file referenced by a mandatory "read before any OpenSpec or Git operation" line reaches the agent at the right time and does not change `openspec/config.yaml` behavior. Alternative (config `context`) rejected for the timing reason and because it would also inject ~15KB into every artifact prompt.
2. **Pointers instead of enumerations.** CLI surface → `memon --help` and `packages/cli/src/index.ts`; HTTP routes → `apps/web/app/api/**/route.ts`; SSE topics → `BACKEND_EVENT_TOPICS`; wiki kinds → `packages/core/src/wiki/kinds.json`; domain rules → `openspec/specs/<name>/spec.md`. Counts are not hard-coded because they drift (e.g. the digest kind is being retired by an active change).
3. **File model is a skeleton only**: Experiment bundle shape and canonical H2 list location, Run directory naming, wiki page layout, `FS_CONVENTION_VERSION` location, and the corrected Run README model (no required H2, membership declared by the Experiment `runs` list; `experiment:` in a Run README is legacy and validated but never written).
4. **CSS verification derives the stylesheet URL from served HTML** (`<link rel="stylesheet" href=...>`), then greps the token with a pattern that tolerates minified output. This works for both dev (`/_next/static/css/app/layout.css`) and prod (hashed file names).
5. **Failure modes keep their F1–F5 labels** so external references (e.g. `git-status` spec's "F4") remain valid.

## Risks / Trade-offs

- [Pointers are less convenient than an inline list] → Each pointer names an exact file or command that answers the question in one step.
- [Describing the post-cleanup state before the concurrent change lands] → Only two statements depend on it (no Backend daemon; hooks installed by `pnpm install`); both are phrased as the intended state and the concurrent change is already specified.
- [Agents skip the referenced WORKFLOW.md] → The reference is placed in the hard-rules area and in the OpenSpec section as a MUST.

## Migration Plan

Documentation only; takes effect on the next agent session. Rollback is reverting the two files.
