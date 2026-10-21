## Why

Central lists and details now read only the source-published Experiment, Wiki and Report catalogs, so a document an agent writes directly stays invisible until someone runs `memon refresh` at the project source. Today that step is easy to get wrong: one unindexable Report aborts the refresh after part of the index was already rewritten and names only the first problem; a targeted `refresh E0001` silently leaves Wiki and Report catalogs untouched; there is no way to check whether the published index is current; skills mention refresh only in passing; and the website answers an unpublished `W0004` with the same 404 as a page that never existed.

## What Changes

- `memon refresh` validates every Wiki and Report entry before writing anything. If any document cannot be indexed (identity or directory name, unparseable frontmatter or manifest, missing required manifest fields, duplicate ID), it writes nothing, keeps the previous index, lists every invalid document with its reason and exits non-zero. Content diagnostics that do not prevent indexing keep their current behaviour (published, listed, non-zero exit) and the output states whether publication happened.
- `memon refresh` reports Report counts and diagnostics beside Runs, Experiments and Wiki pages.
- New `memon refresh --check`: builds the catalogs in memory and compares them with the published ones without writing; it lists missing, extra and changed entries and invalid documents and exits non-zero unless the index is current.
- Help text states that targeted `refresh E…` recomputes those Experiments' results and records only, while plain `refresh` republishes all three catalogs.
- Bundled skills gain one precise index procedure: when to refresh (after any direct create, edit, move or delete of Experiment, Wiki or Report files), which form to run, where (the project source host), how to verify (`--check`, then the new IDs in `.memon/index/*.json` or `memon show`), how to handle a refusal (fix every listed document, rerun) and what never to do (commit or hand-edit `.memon/index/`).
- Central: when a detail lookup misses an ID that matches its kind's identity rule (`W<NNNN>`, `R<NNNN>`, `E<NNNN>-<slug>`), it probes only the directories that ID could live in. If the document exists there, the response is a distinct `NOT_REFRESHED` 404 and the page shows only "Not refreshed"; otherwise the normal not-found. IDs that do not match the rule get the normal not-found without any probe.

## Capabilities

### New Capabilities

### Modified Capabilities
- `derived-index`: adds atomic, fully-reported refresh validation, the read-only `--check`, and the central unrefreshed-document distinction.
- `memon-skills`: adds the index refresh and verification procedure for agents.
- `wiki-viewer`: the shaped-but-absent page state distinguishes "Not refreshed" from not found.

## Impact

- `packages/core` (catalog build/publish split, rebuild ordering, check), `packages/cli` (`refresh` output, errors, `--check`, help), `packages/skills` (PREFLIGHT and the research, wiki and report skills), `packages/backend` (bounded probe, error code), `apps/web` (Experiment, Wiki and Report detail states) and tests.
- CLI and skills change: MINOR release; afterwards update cluster CLI installations and refresh managed skills in projects.
