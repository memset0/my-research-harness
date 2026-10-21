## 1. Implementation

- [x] 1.1 Let `ReportHtmlEmbed` take an optional controlled `expanded` / `onExpandedChange` pair (Escape and the toolbar use the same setter); verify existing embed tests still pass
- [x] 1.2 Sync the expanded state with the `expanded` query parameter in `ContentPresentation` when enabled, and enable it for full Report and full Wiki pages only; verify with component tests for reading the parameter and replacing the URL

- [x] 1.3 Replace the URL with `null` history state so Next mirrors it into `useSearchParams` (its own `__NA` state is ignored by the sync, which left Expand working only after a reload); verify the hook test asserts a `null` state

## 2. Verification

- [ ] 2.1 Run the touched tests, web typecheck and Biome; after deployment open a bundle page with `?expanded=1` and confirm the served bundle uses the new code
