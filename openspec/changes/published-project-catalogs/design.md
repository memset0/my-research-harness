## Context

See proposal.md. FS11 already publishes a Run/Experiment snapshot, but Report discovery still walks directories and Wiki readers do not consistently use source publication. Persistent transport observations outlive summary windows and survive restarts.

## Goals / Non-Goals

Goals: coherent source identity, no FS11 browse-time discovery, short bounded memory reuse, no central project-file dumps. Non-goals: research-document migration, changing experiment results, automatic source scanning on deployment, translation or UI-preference storage changes, managing application lifecycles.

## Decisions

- Publish three independent atomic per-kind JSON catalogs with summaries and relative entry paths. Existing snapshot/events remain the compatibility and Run-record layer; catalogs are small browsing interfaces. Each catalog is one atomic read for its list and identity lookup, so no multi-file transaction is needed for a single list/detail kind.
- Full refresh builds content summaries from source. Experiment lifecycle publication derives its summary from the current snapshot; content lifecycle writes publish their affected inventory. Failed publication stays explicit and recoverable with refresh.
- Read FS11 catalogs through contained paths. Detail reads reuse the registered entry, never directory hints. Duplicate IDs and malformed catalogs fail explicitly. Existing legacy projects keep their compatible discovery, also under short memory policy.
- Remove dump initialization, restoration and periodic writing, including the store bridge. Compatibility configuration accepts old selectors but normalizes them to memory. Old dump bytes are left alone for operator cleanup.
- Primitive memory observations own freshness (30 seconds maximum); backend parsed projections validate against those observations instead of adding an independent lifetime. Expiry revalidates synchronously; source failure remains an honest error. Manual requests revalidate. Browser reuse is short and does not imply polling.
- List summaries contain maintained metadata and local lint, not demand-loaded evidence. Wiki target-evidence reads belong to detail/explicit evidence paths; no unrelated Run hydration to draw navigation.

## Risks / Trade-offs

- Cold restart requires source availability → read small catalogs first; report errors rather than restoring obsolete data.
- Old CLI writers may not publish new catalogs → install the new CLI and run explicit refresh; no automatic migration or hidden Web scan.
- Stale registrations after direct edits → concise skills require refresh after authoring; missing target is surfaced and never guessed through scans.
- Concurrent writers → retain existing source writer locks and atomic per-file replacement; no central catalog writer.

## Migration Plan

Build and verify 11.13.0, install CLI, explicitly refresh current registered projects, then deploy the exact central release and test list/detail through native and remote access. Old research files and tracked results are preserved. Rollback uses the prior frozen central build; additive ignored catalogs may remain. No automatic OpenSpec archive.
