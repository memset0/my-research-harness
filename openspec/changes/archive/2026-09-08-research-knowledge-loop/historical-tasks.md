# Historical implementation record

This is the pre-closeout checklist, including superseded designs and unchecked verification. It is retained as evidence, not the final delivered contract. No unchecked item is retrospectively asserted to have passed.

## 1. Confirmed CLI and skills cutover

- [x] 1.1 Remove manual Journal append/digest-mark commands and handlers; verify old invocations fail, native calls record automatically and historical Journal bytes remain unchanged.
- [x] 1.2 Fix diagnostic Journal query Experiment/Run filters and timezone-aware since filtering with bounded stable pagination; verify the reported ignored-filter reproduction no longer returns unrelated events.
- [x] 1.3 Remove Journal from the CLI default scan and document diagnostic-only explicit reads; verify scan behavior and update only affected observable-contract tests.
- [x] 1.4 Update Drive, Experiment writer and Wiki maintenance with scoped related-document writeback and one CLI-owned journal submit batch; verify no Agent Journal file operations, duplicate native records or expanded lifecycle authority.
- [x] 1.5 Retire append/digest skills and remove ordinary Journal reading/writing from every supported bundled skill and shared reference; preserve standalone doctor guidance and update installer-owned retirement handling without deleting unrelated user skills.
- [x] 1.6 Run focused CLI/installer regression tests, a built-CLI temporary-project smoke scenario, and affected package typechecks; verify no stale supported skill commands remain.
- [ ] 1.7 Synchronize the reviewed skill changes to the configured project on its real host and verify supported files, retired managed skills and unrelated custom skill preservation.

## 2. Automatic history storage and service cutover

- [x] 2.1 Implement per-invocation storage and automatic CLI classification/finalization; verify successful, failed, conflicting, no-op, interrupted and process-exit calls, concurrent invocations and pure-read/dry-run exclusion.
- [x] 2.2 Integrate invocation recording at Backend mutation boundaries without duplicate legacy appends; verify history preservation and that recording failure does not roll back a successful research write.
- [x] 2.3 Implement journal submit --files with bounded managed-file checks and CLI-computed fingerprints; verify safe batches, unsafe/symlink paths, retries and absence of Agent Journal file operations.
- [x] 2.4 Remove manual Journal service/UI endpoints, default web scan/handoff inclusion and digest managed writes; preserve scoped legacy reads and owner-only new diagnostics, and verify actual rendered controls and authorization.

## 3. Evidence and claim confirmation

This section remains tracked design work outside the user-confirmed Journal/digest implementation boundary. Do not mark it complete or invoke these APIs from installed skills before separate implementation.

- [ ] 3.1 Implement versioned evidence sidecars, deterministic claim locators and scoped source fingerprints without changing the v6 bundle; verify partial coverage, missing sources and independent unchanged claims.
- [ ] 3.2 Implement explicit evidence check and exact-claim confirmation/revocation commands with content and metadata CAS; verify documentary checks do not imply reruns or human consent.
- [ ] 3.3 Implement Backend/gateway evidence and activity capability negotiation, safe routes and cache invalidation; verify unsupported/read-only/viewer cases and host isolation.
- [ ] 3.4 Integrate the delivered Wiki interfaces while preserving existing document review and deferring HF-02 precedence changes; verify source changes invalidate evidence independently of prose edit times.
- [ ] 3.5 Render Experiment/Wiki evidence coverage and per-claim human confirmation independently; verify actual desktop/mobile output and exact-confirmation conflict behavior.

## 4. Integrated verification and documentation

- [x] 4.1 Update public CLI/skill documentation and canonical examples for the completed surfaces without deployment facts; validate the OpenSpec change and compare supported commands against examples.
- [x] 4.2 Exercise native invocation recording, direct document-batch submission, diagnostic-only reads and retired digest behavior on an isolated project; verify no-read effects, truthful failed/no-op outcomes and historical preservation.
- [ ] 4.3 Verify the final installed CLI/skill/service versions and changed behavior on the configured deployment using the exact-revision release policy; keep concrete deployment records only in LOCAL.md.
