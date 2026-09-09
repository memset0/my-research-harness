## Context

See proposal.md. The existing membership migration has reviewed plans, source
fingerprints, external backups and a marker-last apply flow. Its final FS7 gate
is intentionally deferred. Concurrent figure and translation edits must survive.

## Goals / Non-Goals

**Goals:** One Wiki read/write model; deterministic, recoverable Digest conversion.

**Non-Goals:** Reviving scheduled digest generation, advancing journal cursors,
marking content verified, merging digest prose, or independently releasing FS7.

## Decisions

- Add a statusless `digest` registry entry, explaining time-window summaries as
  distinct from durable findings and single-meeting notes. Retain dates when known.
- Remove legacy routing and observation instead of maintaining a second adapter.
  Old URLs are retired; the migration receipt maps D identities to W identities.
- Extend migration plans with explicit create/delete operations. Inspect all Wiki
  IDs before allocating new W IDs; deterministic ordering and full preconditions
  protect against existing pages, duplicate legacy IDs and stale reruns.
- Preserve legacy frontmatter fields and body, changing identity/kind only and
  storing `legacy_id`. Relative links must keep their original target; unsupported
  embedded relative-path constructs block conversion rather than silently breaking.
- A reviewed plan includes original and destination bytes and fingerprints.
  Apply validates all sources/destinations before writes, verifies resulting Wiki
  documents before deleting originals, and updates the FS marker last. Rollback
  restores sources and removes only unchanged generated destinations.
- The membership-only `keepVersion` preparation path must not implicitly delete
  legacy digests while an older reader is deployed. Final v7 planning includes
  digest conversion by default; explicit digest-inclusive preparation, if offered,
  must be opt-in and documented.

## Risks / Trade-offs

- Concurrent Wiki creation → revalidate inventory before allocation/apply.
- Noncanonical files or escaping symlinks → explicit blockers, no silent omission.
- Legacy IDs and relative assets → preserve provenance and link semantics; do not
  promote journal summaries into findings or mutate cited evidence.
- Partial failures → durable preimages, marker-last commit and checked rollback.
- Active deployment and shared work → isolated verification; do not deploy removal
  until the coordinated data migration and version gate permit the reader switch.

## Migration Plan

Complete focused tests and isolated UI checks, then archive the removal change
only once its tasks pass. Coordinate the final v7 release with the existing
membership change. Preview all legacy digests, review blockers, apply with backup,
verify Wiki identities/content and absence of legacy files, then switch readers.
Rollback uses the receipt and the previous compatible deployment, not git reset.
