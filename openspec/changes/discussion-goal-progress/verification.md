# Verification

## Change-relevant testlist (2026-11-27)

Run after rebuilding `@memon/core` and `@memon/backend` dist.

| Package | Files | Result |
|---|---|---|
| core | `src/discussion/*` (incl. new `goal-progress.test.ts`), `src/project-catalogs.test.ts` | 7 files, 44 passed |
| cli | `commands/discussion.test.ts`, `commands/lightweight-project-flow.test.ts` | 2 files, 10 passed |
| skills | all | 2 files, 8 passed |
| backend | `discussion-routes`, `discussion-history`, `project-catalogs`, `document-service` | 4 files, 21 passed |
| web | `discussions-view`, `query-keys`, `api-route-manifest`, `route-classes`, `document-scope`, `inbox-shell`, `[host]/[project]/pages`, `discussion-view-state` | 8 files, 132 passed |

Root `pnpm typecheck` passes. The Report page suites keep their 8 known failures in `test/browser/report-bundle.test.tsx`, which predate this change (last touched 2026-10-22); the new citation query adds none.

## Rendered check (neutral fixture, production build, loopback preview)

The fixture discussion has a goal, two settled-and-done units, one agent-decided question in progress, one OPEN choice question, two subgoals (TODO and DONE), `refs` to a registered Report plus an inline link, and one unregistered ref.

- **Detail page, desktop 1280 and 390 viewport.** The goal line, two Progress bars (settled 4/5, done 2/5), the "1 waiting for you" badge and the work, agent-decided and Report badges all render. The Report badges are deduplicated per Report and anchor. The unregistered ref is shown as a source diagnostic. Both subgoals render a comment-only "Send feedback" form. There is no horizontal overflow and no page exceptions.
- **List page.** Rows show the goal and `settled n/m · done n/m`.
- **Report page.** "Referenced in discussions" lists both citing questions, linking to `/d/2#QUEUE` and `/d/2#MIGRATE-CLI`.
- **CSS.** The served CSS defines `--background`, `--foreground` and `--card` as oklch values.
- **Failed requests.** Only `favicon.ico` (404) and the fixture's unconfigured `git-status` (409), both of which predate this change.
