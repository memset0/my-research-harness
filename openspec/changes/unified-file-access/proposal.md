## Why

Moving central outside a cluster requires the same project semantics over native files, NFS, SSHFS and an authenticated file agent. Today storage selection also selects cache behaviour, and independent validation loops cannot share one recheck schedule or source budget.

## What Changes

- Separate access transport (`filesystem`, `sshfs`, `agent`) from cache policy (`none`, `memory`, `memory-disk`): native direct, native memory-cached, SSHFS tier-cached and agent tier-cached access.
- Unify ordinary and conditional reads as `read(path, { knownVersion? })`, with equivalent conditional direct-child listings and distinct metadata queries. Unchanged responses omit content; content versions describe the bytes actually read.
- Separate successful-observation reuse intervals and adaptive recheck backoff from concurrency, operation-rate and byte budgets. Share scheduling by physical data source across projects and callers.
- Keep one central observation state for reads, cached content, versions, freshness, pending checks and logical subscriptions. Logical watch remains a polling convenience, never a filesystem watcher or remote subscription primitive.
- Add an optional independently packaged, authenticated file agent with project-scoped permissions, containment, conditional atomic writes and bounded idempotent retries. Agent write enablement requires explicit acknowledgment that project memon writers use the shared-lock CLI version. It provides file operations only, without business parsing, Git, Slurm, command execution or subscriptions.
- Protect directory moves and quarantine deletion with bounded generic file fingerprint prerequisites checked under the shared writer lock; negotiate this optional capability without weakening conflicts on older agents.
- Add optional bounded, expiring read-only handles for stable streamed reads across atomic pathname replacement, with opened-file metadata and explicit compatibility failures; keep dynamic range polling separate.
- Keep agent protocol compatibility independent of `MEMON_RELEASE`, with explicit major version and capability negotiation; routine central releases do not update or restart the agent.
- Unify host-qualified and legacy unqualified entries on the same new file primitives, observations, budgets and writer locks, preserving unqualified URLs and response projections without requiring a host field. Remove active legacy warmup/parsed caches and independent polling.
- Preserve legacy configuration through normalization, distinguish source unavailability from absence, and retain original timestamps across cache restart. SSHFS and agent share central tiered-cache policy.

## Capabilities

### New Capabilities

- `remote-file-protocol`: stable authenticated file-only protocol, conditional reads/listings, metadata, atomic conditional mutations, request replay, limits and compatibility.

### Modified Capabilities

- `project-file-store`: transport-independent observations, explicit cache policy, conditional access and unified logical subscriptions.
- `file-operation-scheduler`: shared recheck timing, fairness, source concurrency/rate/byte budgets across cached transports.
- `file-access-settings`: expose cache-policy-aware freshness and separate effective/pending scheduling settings.
- `runtime-cache`: route domain dependencies and background validation through the same observations.
- `central-cluster-routing`: resolve configured agent projects without browser-selected endpoints or fake local roots.
- `cluster-backend-lifecycle`: retain CLI-only installation and introduce an optional independently released file agent, separate from the in-process Backend package.

## Impact

- Core: configuration normalization, file adapter contract, Store scheduling/persistence, project I/O and mutation helpers; keep CLI reads outside a central context current.
- Backend/Web: project contexts, services, derived-index validation, resource freshness and settings; audit native filesystem and file-handle bypasses before enabling agent-backed projects.
- New standalone file-agent package and protocol/client boundary; share a minimal neutral containment/locking implementation without importing business services.
- Documentation: deployment/config examples, agent installation and credential rotation, independent protocol lifecycle and failure semantics. Examples contain neutral placeholders only.
- No project filesystem convention migration. Select the release increment from the actual changed distributed surfaces under repository policy; do not hard-code a release number in this plan.
- Existing Run launch and scheduler changes remain independent: this agent supplies no execution provider. Actual host migration and operator deployment require their own scoped rollout.
