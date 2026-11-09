# Tasks

Implementation authorized by the owner on 2026-11-08. Track verified completion only.

## 1. Shared discussion model

- [x] 1.1 Add discussion DRAFT/OPEN/CLOSED metadata and structural question parsing with free-form categories, exact section hashes and line diagnostics; verify tests for nested headings, fenced examples, duplicate IDs and invalid schemas.
- [x] 1.2 Add typed JSONL events, semantic answer-validity hashes separate from exact section hashes, pending response reduction and bounded snapshot copies; verify resolve remains DECIDED until a later change, plus malformed lines and UTF-8 bounds.
- [x] 1.3 Add contained discovery, DRAFT creation, explicit lifecycle transitions, minimal fence resolution and recoverable acknowledgement/reply writes; verify unfinished CLOSED discussions retain question states/history, reopening preserves identity, and writes preserve unrelated bytes under concurrency.

## 2. Guarded append transport

- [x] 2.1 Extend the file protocol/client with append and expectedSize plus capability checks; verify protocol tests reject invalid payloads.
- [x] 2.2 Implement scoped Go File Agent appends and bounded discussion lifecycle replacements using writer locks and replay; document capability/grant support and verify Go tests cover missing files, races, replay, scope and read-only refusals.
- [x] 2.3 Implement native/SSHFS/agent append parity and central discussion edit configuration; verify append and configuration tests cover conflict and permission isolation.

## 3. Catalog and CLI workflow

- [x] 3.1 Publish and validate discussions catalogs with lifecycle and free-form category summaries during refresh without hiding invalid questions; verify catalog/refresh tests and actionable missing-registration errors.
- [x] 3.2 Add discussion create/list/show/pending/resolve/reply/decisions CLI commands with structured output and exit-9 conflicts; verify command tests and help output.
- [x] 3.3 Update English bundled research guidance and CLI documentation with an author/answer/resolve example; verify documented commands against a neutral local fixture.

## 4. Backend and browser data access

- [x] 4.1 Add contained backend list/detail/respond services, OPEN-only response admission, current-snapshot validation, history comparison and bounded append retries; verify tests for closure after page load, changed sections, concurrent feedback and partial recovery.
- [x] 4.2 Add host-qualified backend routes, ordinary Next routes, owner close/reopen status edits, DTOs, manifest edit classifications, API helpers and query keys; verify route tests for owner/viewer and read-only Project authorization.
- [x] 4.3 Extend whole-Project share reads and contained relative assets for published OPEN/CLOSED discussions; verify DRAFT content/assets exclusion, viewer reads, asset containment and response refusal.

## 5. Browser interaction

- [x] 5.1 Add Project navigation with default OPEN browsing, CLOSED history and waiting-for-you/decisions views; verify DRAFT exclusion, lifecycle filtering, unfinished CLOSED history and error rendering in component tests.
- [x] 5.2 Add single-column question cards with shared Markdown/components, free-form category grouping/filtering, question-status overview, stable anchors, preference adoption and DECIDED folding; verify custom/renamed category behavior, rendered content and anchors.
- [x] 5.3 Add typed owner response forms, comments/history and REVISED comparison with honest fallback notices; verify form tests cover all four types, conflicts and read-only viewers.
- [x] 5.4 Persist last-displayed discussion state in localStorage and animate fetched changes; verify changed/new content and reload comparison, identical/failed fetches, storage failure fallback, reduced motion and preservation of scroll, expansion and unsent input.

## 6. Convention and integration verification

- [x] 6.1 Add the seven-section v11-to-v12 guide and align version policy/documentation for the explicit discussion convention boundary; verify guide checks and an isolated marker-only migration preserving existing documents.
- [x] 6.2 Run the explicit change-relevant testlist, root typecheck, touched-file Biome checks and OpenSpec validation; record actual results and unrelated failures.
- [x] 6.3 Build production in an inactive output directory and verify real browser rendering, mobile layout, answers, CLI pending/resolve/reply, revision handling, referenced assets and CSS tokens against a neutral fixture.
