## Why

Research knowledge needs a typed, source-linked document workspace alongside Reports, with explicit human review rather than inferred scientific approval. This proposal records the accepted implementation, including the subsequent CLI and central-service integration, not the retired remote-Backend architecture.

## What Changes

- Deliver Wiki Markdown and bundle discovery, typed kinds, IDs, source references, diagnostics, components and optimistic writes without changing filesystem convention v6.
- Deliver the Wiki viewer, navigation and paired-document workspace while preserving existing Reports and project-qualified identities.
- Deliver native Wiki authoring, migration, component and commit commands. The final review CLI exposes log, whole-Wiki committed diff, verify and unverify; it does not expose per-page review ls or CLI source-staleness traversal.
- Resolve referenced artifact metadata in Web only. Native CLI listing, lint and backlinks operate on declared Wiki content without crawling referenced Runs or attachments.
- Serve Wiki through the unified central Web/API and primitive file observations. Refresh via foreground heartbeat; no remote Backend daemon, parsed-Wiki cache or document SSE is required.
- Keep Git-backed human review separate from source staleness and from unimplemented per-claim evidence confirmation.

## Capabilities

### New Capabilities
- `wiki-store`, `wiki-cli`, `wiki-viewer`, `wiki-workspace`, `memon-wiki-skill`: delivered Wiki data, operations and presentation contracts.

### Modified Capabilities
- `cluster-backend-api`, `runtime-cache`, `memon-cli`, `memon-skills`, `web-dashboard`, `web-layout`, `page-titles`, `report-workspace`: integrate Wiki without reviving retired hosting or command surfaces.

## Impact

Core Wiki parsing/review, CLI commands, central project services, Web components and bundled skills. Initial implementation was already committed; this closeout includes the final integrated behavior and canonical specification reconciliation.

## Accepted Boundary and Follow-up

The user accepted the current codebase on 2026-09-08. Git history/review may still be slow; this is not a universal latency guarantee. Scientific per-claim confirmation, automatic reruns and completed research are not implied. Machine migration, cache transfer and new deployment are separate operations. Direct archive skips the pre-archive full unit suite; historical evidence is retained without claiming that suite passed.
