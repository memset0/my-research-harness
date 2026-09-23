## Why

`memon wiki commit` stages every change under `docs/wiki/` and stops at a local commit. In a working tree shared by several agents that sweeps other agents' in-progress wiki edits into one agent's commit, and every commit then waits for someone to push it. The owner wants each agent's wiki change committed with exactly the pages that agent changed and pushed automatically; other already-committed local work may go out with the same push.

## What Changes

- `memon wiki commit [<page>...]` accepts the pages to commit (id or slug). With pages, it stages and commits only those pages' paths (single file or bundle directory, `<stem>__assets/`, and renames or deletions of the same id), leaving every other staged or unstaged change untouched. Without pages it keeps today's behavior (all of `docs/wiki/`, `MIXED_INDEX` refusal).
- After committing, the command pushes the current branch to its configured upstream with a normal non-force push by default; earlier unpushed local commits go with it. `--no-push` skips the push. When the push cannot happen (no upstream, rejected, network/auth failure) the commit stays and the command exits 1 with `PUSH_FAILED`, naming the SHA and git's reason; it never pulls, rebases, merges, or forces.
- The `memon-wiki` skill commits only at a stopping point (not while dependent experiments run or questions to the owner are open, unless the owner asks for a version now), commits each coherent batch of related page changes as one commit, always naming the pages it changed, relies on the automatic push, and reports the SHA and push result.
- CLI and skills change -> MINOR release together with the other in-flight wiki changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-cli`: page-scoped `memon wiki commit` with automatic push.
- `memon-wiki-skill`: commit-and-push workflow for batches of the agent's own pages.

## Impact

- `packages/cli/src/index.ts`, `packages/cli/src/commands/wiki.ts` (+ `wiki.test.ts`); `packages/skills/memon-wiki/SKILL.md`; `AGENTS.md` CLI summary.
