## 1. Remove the side workspace

- [x] 1.1 Delete the side Report/Wiki surfaces and their state: `workspace-pane-provider.tsx`, `report-pane.tsx`, `wiki-pane.tsx`, `workspace-resize-handle.tsx`, `hooks/use-report-workspace.ts`, `use-wiki-workspace.ts`, `use-workspace-panel-width.ts`, the side-workspace URL helpers and their tests; unwrap the provider and split outlet from `providers.tsx` and the project/manage layouts, and drop the split offset from `project-footer.tsx`
- [x] 1.2 Make every artifact link (bare identifiers and resolved file links, on every surface) and every "Cited by wiki" entry link to the target's canonical full page; remove the source-surface plumbing from the Markdown artifact-link provider; verify with Markdown, citation and navigation tests

## 2. Old links

- [x] 2.1 Redirect page URLs carrying `report`, `reportSurface`, `wiki` or `wikiSurface` to the same URL without them in `middleware.ts`, before authentication; verify with middleware tests

## 3. Verification

- [x] 3.1 Run the touched tests, `lib/server/layering.test.ts`, web typecheck and Biome; after deployment open an Experiment page with legacy `report=` parameters and confirm the redirect, and confirm an Experiment's Report link opens the Report page
