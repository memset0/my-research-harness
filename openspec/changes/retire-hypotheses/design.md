## Context

See proposal.md. The feature currently spans Web navigation and heartbeat, a Backend route, file caches, Wiki source inventories, project scans, CLI creation options and Experiment rename. Historical document schemas are shared with older readers.

## Goals / Non-Goals

Remove active domain behavior and its I/O. Preserve project bytes and old record readability. Do not invent a replacement domain, bulk-convert projects or bump the filesystem convention.

## Decisions

- Delete dedicated UI/API/parser/status exports and remove every ordinary runtime caller rather than hide a tab.
- Retain only inert legacy document fields/sections or cache compatibility slots where necessary to avoid silently dropping historical metadata. They do not validate H IDs, scaffold new content, create links, count claims or load the retired file. Metadata-only writers preserve existing data.
- H references no longer resolve. Generic Markdown scanning still checks historical documents for inbound Wiki links; retirement must not weaken deletion safety.
- Keep historical migration executors and guides as version-scoped records. Current instructions advertise retirement, not the old workflow.
- No project mutations or automatic replacement Report/Wiki are part of rollout. Ship within FS11 with a CLI minor release.

## Risks / Trade-offs

- Hidden indirect reads or writes → spy on filesystem access and test rename against an unchanged historical file.
- Old cached fields → maintain compatible decoding and remove semantic consumers; verify old project reads.
- UI/server coupling → focused route/query/navigation tests, typecheck and real desktop/mobile rendering.

## Migration Plan

Deploy the exact release without changing research files. Retain the previous frozen deployment for rollback. Project-specific conversion is deferred to a later user decision.
