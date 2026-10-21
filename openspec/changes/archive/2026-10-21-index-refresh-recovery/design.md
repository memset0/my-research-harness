## Context

`rebuildIndex` writes the snapshot (and with it the Experiment catalog), then calls `publishWikiCatalog` and `publishReportCatalog`, each of which builds and writes its catalog and throws on the first document it cannot index. A Report failure therefore surfaces after the snapshot, the Experiment catalog and the Wiki catalog were already replaced. The CLI's `refresh` maps to `rebuildIndex` (no targets) or the Experiment results rebuild (targets). Backend detail lookups read the catalogs and throw `RESOURCE_NOT_FOUND` on a miss.

## Goals / Non-Goals

**Goals:** atomic publication with a complete list of unindexable documents; a read-only freshness check; an exact agent procedure; a cheap, rule-gated "Not refreshed" diagnosis in central.

**Non-Goals:** central writing or rebuilding catalogs (many central projects are read-only); rendering unpublished documents; blocking publication on content-quality diagnostics; changing catalog formats.

## Decisions

- **Build, then write.** Catalog construction is split into pure builders that return `{ entries, invalid }` (collecting every problem instead of throwing) and writers. `rebuildIndex` builds the snapshot and all three entry lists first; any `invalid` returns a new `invalid` status with the issues and writes nothing. Only then are the snapshot, Experiment, Wiki and Report catalogs written. `publishWikiCatalog` / `publishReportCatalog` keep their signatures for other callers (Wiki CLI writes) and throw one aggregated error listing all issues. Duplicate IDs within a kind are reported as invalid by the builders. Alternative: write to temporary files and rename all at the end — rejected; validation-first already guarantees that nothing is written on refusal, and the rename window is no different from today.
- **What counts as unindexable.** Exactly the conditions under which a builder cannot produce an entry: identity in the path, frontmatter/manifest parse errors, required manifest fields and duplicate IDs. Lint diagnostics stay advisory-but-failing as today, because existing projects carry many and blocking them would stop those projects from ever refreshing. The output's `published` flag makes the two outcomes unambiguous.
- **Check reuses the builders.** `refresh --check` runs the dry-run snapshot build plus the builders and diffs against `.memon/index/{experiments,wiki,reports}.json` by ID, resource and summary `mtime`; `generated_at` is ignored. It takes no lease and writes nothing.
- **Central probe is rule-gated and shallow.** A helper in the backend receives the kind and ID after a catalog miss. It returns immediately unless the ID matches `^W\d{4}$`, `^R\d{4}$` or `^E\d{4}-[a-z0-9][a-z0-9-]*$`. Wiki: list `docs/wiki`, then each kind directory, looking for `W<NNNN>-*` (bundle directory or `.md`). Reports: list `docs/reports` and each category directory for `R<NNNN>-*`. Experiments: check that `docs/experiments/<id>` exists. Reads go through the existing contained project file access (and its short memory reuse), never document bodies. A hit raises a dedicated `RESOURCE_NOT_REFRESHED` error mapped to HTTP 404 with code `NOT_REFRESHED`. Alternative: render the document from source with a banner — rejected by the owner; lists and details stay consistent.
- **Minimal UI.** Detail panes check the API error code and show only "Not refreshed" (with the ID) in place of the not-found copy; rails and navigation are unchanged.

## Risks / Trade-offs

- [A broken document blocks every new document of all kinds] → intended by the owner; the response lists all problems so one repair pass suffices.
- [Probe cost on a remote File Agent project] → at most one listing per Wiki kind or Report category per miss, only for well-formed IDs, reused in memory for up to 30 s.
- [Experiment IDs without the slug (`E0004`)] → do not match the rule and get the ordinary not-found, consistent with the routes, which use full Experiment IDs.

## Migration Plan

MINOR release (CLI, skills, central). Deploy central, update CLI installations on the clusters, then refresh managed skills in projects with `memon install-skills`.
