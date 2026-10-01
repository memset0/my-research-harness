# Verification — 2026-09-09

## Focused checks

- Core: migration, Wiki registry and Wiki lint — 65 passed. Includes combined
  membership/Digest conversion, kept FS6 marker, deterministic W allocation,
  D provenance, preserved Journal/review bytes, relative links, unsafe paths,
  reference-image blockers, stale inventories, failure recovery and reruns.
- CLI: Wiki kind cases — 5 passed; 66 unrelated cases intentionally skipped.
- Backend: document service, document routes and filesystem monitor — 17 passed.
  Migrated digest pages use Wiki inventory/detail; old routes are absent and
  old files do not emit standalone Digest observations.
- Web: kind Help/API, badges, target identity, auth classification, API manifest,
  prewarm, Report inbox, artifact links and Digest retirement — 94 passed.
- Skills: kind guidance generation and package exports — 7 passed.
- Core, Backend, CLI and Web TypeScript checks passed. Core/Backend builds and
  an isolated Web production build passed. Generated Wiki guidance check passed.
- Strict OpenSpec change validation passed; no full suite or remote tests ran.

## Actual rendered UI

An isolated fixture was converted by the compiled plan/apply/verify CLI from FS6
to FS7, with no remaining Digest source and no pending migration changes. An
authenticated production preview displayed the resulting `kind: digest` page
and its original body, D provenance, unverified review badge and table of contents.
The top bar had no Digests entry; the old Digest API returned 404. Help exposed all
12 registry kinds, including digest. Desktop and narrow mobile screenshots were
inspected. Browser checks confirmed no horizontal overflow or page errors and
compiled CSS definitions for the semantic tokens and 800px content rule.

The isolated build initially required restoring the existing local sqlite native
binding after an offline install with lifecycle scripts disabled; the subsequent
build and browser check succeeded. Existing Report Sheet tests still emit their
missing Dialog description warnings; those unrelated primitives were not changed.

## Release and archive boundary

Implementation is ready, but this is not a deployed FS7 release. The independent
`experiment-owned-run-paths` change remains active and its final version, migration
and rollout gates must finish together. No actual research data, review status,
Journal cursor, production host or deployed CLI installation was changed here.

The change remains active: automatic archive has not bypassed the repository's
full-suite archive gate. Canonical spec synchronization and archive wait for that
gate; active delta specs describe the v7 retirement, including the superseded
historical standalone-Digest clauses. This source change is not a release bump.

Before final v7 apply, regenerate the plan; old plans lacking a Digest section are
rejected. Resolve every unsupported/noncanonical file or embedded relative asset
blocker before conversion. No source is silently skipped. Preserve the external
recovery receipt and use the migration guide in `packages/core/migrations/v6-to-v7.md`.
Unrelated figure and translation work remains outside this change's commit.
