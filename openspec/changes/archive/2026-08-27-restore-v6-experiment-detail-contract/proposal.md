## Why

The central split path currently drops v6 Experiment raw sections and managed YAML documents at the Backend boundary. The Web therefore treats every central Experiment detail as a stale legacy payload and renders deprecated Method/Plan/Caveats projections instead of canonical Implementation, Investigation, Results Variants, Findings, and Limitations.

## What Changes

- Restore the complete safe v6 Experiment detail contract across Core, Backend, central proxy, and browser types.
- Carry ordered raw section metadata, sanitized managed-document data, display sections, diagnostics, read-only state, and Results update metadata without absolute paths or raw filesystem authority.
- Move the canonical Experiment display projection into shared Core so standalone and Backend use one implementation.
- Keep list DTOs compact; managed documents are included only in ID-addressed Experiment detail/results responses.
- Remove the legacy projection as a fallback for current central Backend releases and fail visibly on an invalid/missing current contract.
- Add live/synthetic contract and browser tests proving Implementation, Investigation, and Results Variants render while deprecated Plan/Caveats do not reappear for valid v6 data.

## Capabilities

### New Capabilities

### Modified Capabilities

- `structured-experiment-sections`: Central and standalone Web consume the same canonical v6 managed-document projection.
- `cluster-backend-api`: Experiment detail carries a strict, portable, path-free v6 document payload rather than a legacy-only section subset.
- `web-dashboard`: Current central Experiment pages render managed YAML and never silently downgrade to legacy sections.

## Impact

- Affects Core Experiment projection/schemas, Backend protocol and Project serialization, standalone adapters, central proxy contract tests, browser types, and Experiment page fallback behavior.
- Does not modify filesystem convention v6 or the authoritative YAML/README files.
- Backend/CLI artifacts change, so deployment requires a Minor release and exact-revision reinstall.
