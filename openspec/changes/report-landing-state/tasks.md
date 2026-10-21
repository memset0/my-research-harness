## 1. Landing state

- [x] 1.1 Pass the Report list state to the inbox landing pane and render loading, select-a-report, failure or the authoring empty copy accordingly, keeping the show-reports control; verify with `inbox-shell.test.tsx` cases for a populated list with the picker hidden and for an empty list

## 2. Verification

- [ ] 2.1 Run `pnpm --filter @memon/web typecheck`, the inbox component tests and Biome; after deployment confirm the robo-harness Reports landing page loads its list and shows the selection prompt
