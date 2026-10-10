## 1. Callout rendering

- [x] 1.1 Implement shared callout tree transformation and native disclosure with scoped styling; verify types, aliases, custom titles, nesting, suffixes, literal examples and Markdown/link/component regressions in focused renderer tests.
- [x] 1.2 Preserve matching client/server translation segments with callout prose separated from markers; verify focused translation tests.
- [x] 1.3 Accept case-insensitive deprecated markers with optional folding suffixes while preserving reason/date validation; verify core deprecation and lint regressions.

## 2. Integration verification

- [x] 2.1 Run relevant tests, root typecheck, formatter checks and strict OpenSpec validation; record actual results.
- [x] 2.2 Verify real rendered callouts, keyboard disclosure, loaded styling, dark theme and narrow layout in an isolated preview; document checks without modifying research documents.

Focused verification: core deprecation/lint 46 tests; Web callouts 35 tests, existing Markdown 29 tests, translation 15 tests passed. Root and Web typecheck passed. Biome check passed with only pre-existing warnings; strict change validation passed. No full suite was run.

Isolated production preview: real Chromium verified static/closed/open and nested callouts, Enter/Space disclosure, visible 2px focus ring, 3px themed border, rendered math/table, 1440px and 390px layouts, and dark theme. No page errors or horizontal overflow. Screenshots inspected; research documents untouched.
