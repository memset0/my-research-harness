## Context

See proposal.md. FS11 has one research Skill and six optional Skills; public CLI removals shipped independently of the remaining instruction cleanup. Project instructions can retain legacy launch and bookkeeping rules even when installed Skills are current.

## Goals / Non-Goals

Keep the existing seven entrypoints, preserve scientific caveats and human-readable experiments, and eliminate contradictory current-use instructions. Do not migrate research records, rewrite launch logic, merge Wiki/Report roles or disable historical analysis.

## Decisions

- Correct the shared conventions and research entry directly; use short optional references for phase schemas and existing aggregation contracts. Keep the human-reading outcome in the entry instead of introducing a template or another Skill router.
- Fix the Wiki kind-guidance generator and regenerate its shipped output so removed command suggestions cannot return during builds. This helper produces documentation only; the central runtime behavior stays unchanged.
- Audit project-owned executable launchers, their wrapper callers and instruction files separately from public code. Record an exact private path/preimage inventory. Put unconditional nonzero guards before the first side effect in executable entries; preserve Python imports and shell scheduler directives where needed. No bypass flag. Results collectors, native compute libraries and frozen historical Run artifacts are not launch entries.
- Replace obsolete generic project rules with FS11 conventions while preserving explicitly unmigrated collectors and project Git/resource rules. Keep deployment identities and paths out of public artifacts.
- Wiki and Report remain separate Skills. Share concise maintenance semantics: Wiki stays current, Report has an evidence cutoff and relevant source revisions, nearby updates can reuse its identity, and staleness is separate from validity or service availability. Let the agent choose Markdown, static HTML or a live service without mandatory Markdown narration or component conversion.
- New content uses bundles. The current reader still needs a small README adapter for HTML; document that compatibility detail without implying manifest-only discovery exists. The agreed future shape is README.md for Markdown, index.html plus manifest for HTML, and a port manifest for dynamic sites; classification, metadata rendering and proxy support remain a separately implemented platform contract.

## Risks / Trade-offs

- A wrapper can allocate a directory before calling a guarded child: inspect callers and guard every affected entry.
- A script can be a library and an executable: guard execution paths without preventing evidence-reading imports.
- Broad source edits can include unrelated work: compare private preimages and the existing index, preserve unrelated changes and never alter submodules implicitly.
- Removing prose can obscure evidence: retain the question, comparison and interpretation with source references, rather than requiring routine execution narration.

## Migration Plan

Ship a skills minor release within major 11. Verify the installed command workflow and managed Skill copies, then apply the authorized project instruction/launcher cleanup with recoverable preimages. No research conversion or central rebuild is needed for documentation-only generator output. Reverting the scoped instruction/guard changes restores prior files; never apply that rollback as an unapproved launch bypass.
