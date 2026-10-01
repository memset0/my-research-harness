## 1. Registry and migration

- [x] 1.1 Register digest and regenerate guidance; verify registry/CLI/help/generation tests.
- [x] 1.2 Implement reviewed digest-to-Wiki planning and recovery; test content/provenance, IDs, paths, collisions, stale plans, rollback and reruns.
- [x] 1.3 Integrate conversion into final v7 plan/apply/verify with marker-last behavior and unchanged FS6 preparation; verify existing membership regressions and combined fixtures.

## 2. Retire standalone surfaces

- [x] 2.1 Remove Backend Digest capabilities, protocol, discovery and observations; verify routes reject legacy requests and Wiki digest reads work.
- [x] 2.2 Remove Web pages/API/navigation/queries/caches and obsolete domain types; verify typechecks, targeted surface tests and authenticated rendered UI/CSS.
- [x] 2.3 Update current docs/skills and migration guide; verify no active guidance recommends standalone Digest support and generated references do not drift.

## 3. Integration

- [x] 3.1 Run focused cross-package and isolated UI verification, record results, preserve unrelated work, and document the coordinated v7 release gate before archive/push.
