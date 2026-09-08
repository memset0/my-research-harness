## 1. Reader refinement

- [x] 1.1 Scope the card background to the document and add a reversible 800px/full-width toolbar toggle; verify focused regression tests for both nested and outer width limits.

## 2. Verification

- [x] 2.1 Pass focused Wiki tests and Web typecheck, then inspect production rendering, background colors, desktop width toggling, and mobile fit before archiving.

Verified: three focused component tests, Web typecheck and production build passed. Hydrated browser checks at 1920px measured an 800px capped column and 1032px expanded column; both nested and outer limits toggle. Document background resolves to white while outline and outer surface are transparent. Desktop/mobile screenshots inspected; mobile toolbar remains visible with no page-level horizontal overflow. Compiled CSS contains the 800px rule and existing theme tokens. No full suite.
