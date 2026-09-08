## Why

Independent remote services and repeated project scans made document access expensive and fragmented. The accepted code now uses one central Web/API over configured native or externally mounted roots, with shared primitive observations and bounded physical I/O. This proposal describes that delivered architecture rather than requiring another optimization or deployment campaign.

## What Changes

- **BREAKING**: retire remote Backend service/token/daemon lifecycle, proxy negotiation and document event fan-in. The backend package supplies in-process project services; it is not another deployed listener. Preserve host-qualified namespaces, project authorization, read-only data policy and separate share administration.
- Centralize file content, directory and metadata observations in a bounded Store. Use an in-memory LRU and optional versioned local dump for explicitly opted-in SSHFS projects; native roots remain memory-only. UI-preference SQLite is unrelated to project file caching. No cache data migration is required.
- Share deduplicated physical I/O scheduling by storage group with configurable concurrency, default 10; the isolated worker thread-pool cap is 128. Preserve actual in-flight accounting, attention/backoff and bounded metrics. Separate child processes isolate project document/metadata I/O from the Web process; unchanged binary streaming is not claimed fully isolated.
- Discover Runs beneath the implemented logs/, outputs/ and experiments/ roots, stopping descent at recognized Run directories. Add identity inventories for Runs, Experiments, Reports, Digests and Code Reviews without body or membership reads. Wiki aliases may require Wiki frontmatter, but not referenced artifact bodies.
- Refresh document/list resources through non-overlapping foreground heartbeat, semantic versions and shared dependencies. Preserve manual Run-body loading. Separate navigation inventory from detailed reads; do not add a membership or second domain-object cache.
- Deliver page freshness, owner-only file-access settings, effective/pending configuration and optional local restart adapter. A save does not restart or hot-apply settings; no adapter means manual restart guidance.
- Retain explicit local/SSH command providers for supported Git/Slurm operations, with execution roots distinct from read roots. Removed browser terminal, tmux and Herdr surfaces are not restored.
- Deliver independent native CLI and trusted fast-forward-only `memon update`; remote installs do not host Backend services or run test suites, and central releases do not wait for fleet revision equality.

## Capabilities

### New Capabilities
- `project-file-store`, `file-operation-scheduler`, `file-access-settings`: implemented observation, scheduling and configuration contracts.

### Modified Capabilities
- `split-service-deployment`, `central-cluster-routing`, `cluster-backend-api`, `cluster-backend-lifecycle`, `host-qualified-project-identity`, `project-share`, `memon-cli`, `runtime-cache`, `live-updates`, `web-layout`, `release-compatibility`: replace obsolete service/cache boundaries while preserving retained public behavior.

## Impact

Core file access, in-process project services, Web routes and resource lifecycle, native CLI/skills distribution, and public architecture specifications. The user accepts the current codebase on 2026-09-08; the earlier private-candidate phase is historical, not a permanent product requirement.

## Accepted Boundary and Follow-up

Archive does not certify all legacy fault matrices or universal performance targets. Cold discovery, Git history, detailed membership and large-project costs remain optimization opportunities. No scientific data/Run layout migration, extra cache, fleet rollout or production switch is part of this closeout. Preserve prior measurements as historical evidence, not new test results. Direct archive skips the full unit suite.
