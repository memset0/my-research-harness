## Why

Research decisions belong in Experiment and Wiki source documents; Journal should describe tool activity rather than become a second knowledge-authoring workflow. The accepted scope is the implemented Journal/digest cutover and source-document maintenance contract, not the original evidence-review product roadmap.

## What Changes

- Record supported non-readonly CLI and project-service invocations automatically under `.memon/activity/`, including failure, conflict and no-op outcomes. Preserve historical `docs/journal.md` bytes and provide explicit bounded diagnostic queries.
- Deliver CLI-owned `journal submit --files` with bounded managed-path validation and fingerprints; agents do not author Journal prose or operate on its storage directly.
- Remove manual journal append/digest-mark commands, UI/API authors and bundled authoring skills. Normal scan and research handoffs do not load Journal; existing digest GET/discovery remain available without managed editing.
- Maintain research relationships in Wiki roadmap/decision pages and update affected Experiment/Wiki sources with existing authority and optimistic-lock boundaries.
- Integrate with the final unified central service and heartbeat file observations. No remote evidence capability negotiation or independent Poller cache is introduced.
- Align with lightweight execution: doctor and independent document validate workflows are retired; structural lint remains. No digest prerequisite or replacement doctor wrapper is retained.

## Capabilities

### New Capabilities
- `research-knowledge-loop`: source-document ownership and scoped writeback.
- `activity-capture`: automatic invocation records and CLI-owned document submissions.

### Modified Capabilities
- `journal`, `memon-cli`, `memon-skills`, `agent-handoff`, `digests-store`, `cluster-backend-api`, `web-dashboard`, `inbox-viewer`: delivered diagnostic/read-only cutover.

## Impact

Core Journal persistence/readers, CLI invocation hooks and queries, central mutation boundaries, Web authoring removal and bundled skill retirement. Existing human-only Experiment lifecycle and Wiki review permissions are unchanged.

## Accepted Boundary and Follow-up

Accepted for closeout on 2026-09-08. Evidence sidecars, evidence show/check/confirm/revoke, per-claim UI badges and a new human-confirmation protocol were design ideas, not implemented APIs; they are excluded from canonical requirements. No replacement digest loop or automatic confirmation is promised. Deployment/installed-skill verification is not implied by archive. Historical task evidence is retained; direct archive skips the full unit suite.
