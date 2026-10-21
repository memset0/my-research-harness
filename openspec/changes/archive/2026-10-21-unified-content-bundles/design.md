## Context

See proposal.md. Wiki and Report have independent legacy discovery and existing asset routes. File Agent is an independent, mTLS-authenticated file kernel. The custom Web server can forward streaming requests before Next. Existing human-review removal remains in its own active change.

## Goals / Non-Goals

Goals: share a small content metadata contract, preserve old identities, display arbitrary agent-authored presentations, and forward service traffic without owning application lifecycle.
Non-goals: research-data bulk migration, mandatory authoring templates, builds on page read, service execution, Git review, or a new major/FS version.

## Decisions

- Keep W/R identity and existing two-level Wiki/flat Report paths. Accept one optional category level for Reports. Category is an independent free-text metadata field; existing Wiki kind remains a compatibility label. New folders use README.md for Markdown or manifest.json for HTML/service. A manifest wins when both exist; the README remains an optional supporting file.
- New CLI Wiki authoring defaults to a README folder with free prose and arbitrary safe topic categories. Legacy status/source/date fields are optional; missing type-specific sections or literal evidence tokens do not create warnings. No new schema switch is needed.
- Shared metadata uses title, description, category, created_at, updated_at, freshness (CURRENT/STALE), stale_reason, as_of, source_commits. Report evidence cutoff is independent from publication time. Unknown extension fields survive. Explicit freshness overrides legacy source-mtime hints. Presentation uses type html/service; HTML entry defaults to index.html, service declares an integer port and optional entry path. No framework metadata, dimensions, prescribed sections or normalized-data layout.
- Parse manifest metadata without pretending its bytes are Markdown. Existing summary DTOs gain optional shared content fields; content remains exact source bytes for hashes and locked writes. Existing Markdown readers remain supported. Discovery reads metadata only, never starts services or recursively loads application trees for navigation.
- Proxy address is derived from project, document identity and validated manifest, never an arbitrary browser-supplied host/port. Local binds loopback. SSHFS uses the configured SSH execution target and a lazily allocated loopback tunnel. File Agent adds an independently authorized loopback forwarding primitive with operator-configured per-project service ports and existing certificate/source-identity checks; it does not parse document semantics.
- HTTP streaming and WebSocket forwarding use the custom server, strip central credentials, preserve base-path routing and forward prefix headers. Applications serve relative URLs or honor the supplied prefix; no arbitrary HTML/JS rewriting. Authentication is checked before upstream connection. Dynamic applications are owner-only because their APIs/WebSockets cannot generally be proven read-only; shared static content retains existing viewer access.
- Service availability is probed on demand with bounded timeouts/backoff, not at startup for all documents. No service processes are managed. Offline displays explain that the agent/operator starts the declared service.
- Wiki IDs never recycle after deletion: an optional `wiki` value in the small tracked `.memon/id-watermarks.json` file advances under the same writer lock on create/delete. Cache rebuilds cannot lower it. Older readers ignore this additive file; the strict project declaration remains unchanged. No history ledger.
- Wiki retirement is a user decision: move useful time-scoped content to Report or remove it. `memon wiki delete <id>` is the sole deletion entry, with no force bypass and no automatic rewriting/migration. Resolve inbound references only under docs/experiments, docs/wiki and docs/reports (including details, metadata and HTML); exclude Experiment caches/runtime outputs, dependencies and nested repositories before resolving links. Do not enumerate Runs, unrelated project documents or project configuration. Wiki/Report topic names such as cache/data do not exclude their documents; return source paths and locations, exclude internal references, and refuse removal until references are repaired. Recheck fingerprints under the project writer lock; fail closed on unreadable sources or containment violations. Remove the document and exclusively owned bundle assets, then refresh inventory. Historical aliases are not required after all inbound references have been repaired.
- Retiring content into a Report preserves its last-effective time as created_at, uses the current maintenance time as updated_at, and records an actual nearby source revision when an exact historical revision is unavailable, explicitly labeling approximate provenance. Do not substitute the Wiki creation time or the retirement time for the evidence horizon.
- Migration preparation inventories every source, hashes input bytes, records destination and old-link treatment, and preserves unresolved evidence distinctions. Source changes require a subsequent reviewed application; the preview is private operator data.

## Risks / Trade-offs

- Prefix-unaware apps → document their base-URL setting and show the canonical proxy prefix; do not rewrite arbitrary application source.
- Old File Agents lack forwarding → explicit unavailable/upgrade response; never bypass mTLS via a second network path.
- Conflicting README/manifest → manifest precedence is deterministic and documented; locked writes validate manifests before replacement.
- Historical staleness heuristics → retain compatibility only when explicit freshness is absent; do not rewrite evidence validity.
- Public repository privacy → all real project inventories and previews remain outside tracked files.

## Migration Plan

Ship additive FS11 reader/gateway support and concise Skills, verify all three transports locally, then deploy the exact central release. Update the independent local File Agent only with its own tested binary/config backup. Existing content requires no rewrite; rollback keeps prior data readable. Prepare the source migration preview separately before moving content.
