## Context

Existing protocol-v1 agents return `IO_ERROR` for a missing `resolve` target, while `stat` already distinguishes present and missing. The client presents filesystem-like resolution to the Store. See proposal.md for the resulting list failure.

## Goals / Non-Goals

Support existing agents without wire changes or research-file edits. Do not infer absence from arbitrary I/O, authorization, containment or source-unavailable failures.

## Decisions

On `resolve` `IO_ERROR` only, perform one authenticated `stat` for the identical target. A confirmed missing result becomes an Error with `code: ENOENT`; a present result preserves the original resolution error. A failed confirmation propagates its own failure. Successful resolution keeps its existing request count and validation. This avoids a mandatory agent upgrade or an unconditional extra metadata request on every path.

## Risks / Trade-offs

- A failed resolution adds one metadata request. It is bounded and uses the same source identity and credentials.
- Source state can change between the two requests. Absence describes the successful metadata observation, not a transactional snapshot; ordinary refresh can observe recreation.
- Other I/O errors remain failures even when another cause is suspected. No fallback to local files or alternate roots is allowed.

## Migration Plan

Ship the corrected client through a normal release. Existing agents and research filesystem versions remain unchanged. Validate a real agent-backed experiment list before deployment; rollback selects the previous site build if needed.
