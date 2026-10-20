## 1. Lightweight declarations

- [x] 1.1 Parse and serialize lightweight presentation/aggregation settings and derive Variants from Run inventory; verify absent names/binding lists, READY parameters and legacy parsing.
- [x] 1.2 Create minimal FS11 bundles and accept arbitrary README structure with optional companions; verify creation and document-view tests.

## 2. Aggregation and saved results

- [x] 2.1 Implement pure persisted CSV-to-summary reading without Run I/O; verify scalar/stats and READY metric exclusion tests.
- [x] 2.2 Implement contained default/custom per-Variant aggregation with atomic publication; verify 0/1/multiple selection, smoke/history exclusions, metadata, script failure and path escape tests.
- [x] 2.3 Integrate CLI result rebuild/read and directory/READY-Run Variant creation; verify focused CLI tests and typecheck.
