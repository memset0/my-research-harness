## Focused checks

- `pnpm --filter @memon/web exec vitest run lib/experiment-navigation.test.ts components/experiment-card-grid.test.tsx components/app-sidebar.test.tsx`: 3 files, 21 tests passed. Covers lifecycle versus progress, timezone-aware sorting, legacy archive, search, summary errors, host-qualified links, historical deep links and disabled-project read gates.
- `pnpm typecheck`: passed.
- Biome on the seven changed implementation/test files: passed.
- `openspec validate experiment-status-navigation --type change --strict`: passed.
- Production Web build with Node 22.19: passed. Full test suite not run.

## Rendered checks

Neutral production-mode preview verified separate archived/retired collapsed groups, Enter-key expansion, search revealing retired results, ACTIVE including RUNNING and COMPLETED, and sidebar deep-link auto-expansion/current highlighting.

Desktop and 390px mobile screenshots were inspected, including the mobile sidebar drawer and dark theme. Six served semantic CSS tokens were present; no horizontal overflow, page exceptions or static asset errors. No research-project files were changed by navigation or verification.
