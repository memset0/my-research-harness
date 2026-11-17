# Tasks

## 1. Share dialog

- [x] 1.1 In `apps/web/components/manage-shares-dialog.tsx`, make "This page only" issue a service link on a service Report/Wiki page, remove the separate "Service" choice, show the application-access note for that choice and the does-not-reach note for "Whole project", and keep Create disabled for a page link while the page's presentation is loading; update the file header comment and dialog description. Verify with the updated cases in `manage-shares-dialog.test.tsx` (default on a service page posts `service: true`; whole project posts no `service`; non-service page unchanged; Create disabled until the detail resolves).
- [x] 1.2 Run `pnpm --filter @memon/web typecheck`, Biome on the changed files and the selected dialog and shares-route tests; verify all pass.

## 2. Rendered verification

- [x] 2.1 On a production build with a neutral fixture service page, verify in headless Chrome that the dialog shows no "Service" choice, shows the application-access note by default, and that the default Create posts a service link listed as "Service · …".
