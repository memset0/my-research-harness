## Context

The Results endpoint already returns `updatedAt` from `results.yaml` mtime and additionally returns `snapshotAt`. The card renders Last updated from the first but Stale for from the second. This conflates time since checking with age of the backend content.

## Decision

Use one authoritative time: `updatedAt`. Last updated renders it as a local timestamp, and Stale for renders `now - updatedAt`. The one-second display timer remains client-only and performs no request. Refresh replaces `updatedAt` only with the mtime returned by the manual request.

If Refresh reads unchanged content, its mtime is unchanged and so is the computed age apart from normal elapsed time. If content changed, the new mtime causes the status component to show the new source age. Invalid/missing timestamps render an unknown age rather than pretending the content just changed.

`snapshotAt` is removed from the endpoint/detail/client contract because it no longer drives UI or correctness and invites the same semantic confusion.

## Risks / Trade-offs

- Filesystems may update mtime for a rewrite whose semantic content is identical; the backend change time follows filesystem truth.
- External tools that preserve mtime while changing content can underreport freshness; content hashing is outside this fix.
