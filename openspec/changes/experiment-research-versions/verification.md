# Implementation verification

All fixtures use neutral temporary projects. No research project conversion is part of this change. These are focused checks, not the full unit suite.

- Core description/research/summary/cache/schema-upgrade/writer/bundle-lint plus Experiment creation and Experiment/Run rename: 10 files, 122 tests passed after resolving an initialization cycle discovered by cross-package and native ESM execution.
- CLI research/results/document/invocation: 4 files, 50 tests passed. Separate native CLI processes exercised FS10 creation, launch-time enrollment, version advance, Variant deprecation and restoration without nested-lock deadlock.
- Explicit migration and guide: 2 files, 12 tests passed. Coverage includes byte/mode/custom-field preservation, plan freshness, dirty-tree refusal, contained paths, marker-last failure rollback, concurrent edit protection and empty projects.
- CLI typecheck/build and bundled skills build passed. Root typecheck and strict OpenSpec validation passed during integration.

- Shared writer locks: all 4 tests passed, including a real local file-agent/Node writer contention test. A temporary official Go toolchain was checksum-verified; no remote tests or agent installation occurred.
- Stale CLI hash with fresh mtime: native advance and deprecate processes both returned exit 9 and left source bytes unchanged. Annotation CAS error mapping was also checked (15 Results tests passed).
- The unmodified previous released FS9 parser rejected an FS10 keyed description in a native Node process.
- Browser preview passed version advance, Variant hide/show/deprecate/restore, SOTA exclusion, concurrent 409 with preserved reason and explicit reload, historical version selection, historical Run deep links, legacy FS9 rendering, mobile 390px layout and five loaded semantic CSS tokens. No page errors or horizontal overflow. The preview used separate neutral projects and did not replace live output.

- Historical snapshot validation was tightened after reproducing malformed deprecation metadata escaping through the legacy parser. The updated 122-test Core selection passed, including invalid historical timestamps/reasons.
- The approved 9.3.0 / FS9 to 10.0.0 / FS10 transition passes the release policy classifier as `filesystem-major`. The constant pair is advanced together in the separate release commit.

- Backend: `document-service`, `results-summary`, `mutation-routes`, `project-resource-routes`, `route-table` — 35 tests passed. The final historical-import/membership changes were followed by rerunning the first three files (29 tests), including foreign-owner refusal without ledger changes.
- Web: Results card (8), Results table (19), research controls (1), SOTA (7), query keys (46), Experiment sections (3), backend route integration (29), API manifest (6), Results route (6) — 125 tests passed. Final fallback/control changes were followed by the 9 card/control tests and Web typecheck.
- Final root typecheck, strict OpenSpec validation and whitespace validation passed. No full-suite or archive gate was run; the change remains active.

The source preview used the development Node runtime. The separate release is built with the production Node runtime and receives a final rendered check, including navigation from failed current Results into history, before central cutover.
