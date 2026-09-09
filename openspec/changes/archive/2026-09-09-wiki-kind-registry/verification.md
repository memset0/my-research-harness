# Verification — 2026-09-09

Validated in an isolated checkout containing this change, excluding unrelated
pending figure and other development work. No production instance was replaced,
no research pages were moved or rewritten, and no commit/push/review action ran.

## Targeted tests

All commands ran in the isolated checkout. No full suite was run.

| Package | Selected command after `pnpm --filter <package> exec` | Result |
| --- | --- | --- |
| `@memon/core` | `vitest run src/wiki/kind-registry.test.ts src/wiki/lint.test.ts` | 43 passed |
| `@memon/cli` | `vitest run src/commands/wiki.test.ts src/lib/invocation.test.ts -t 'wiki kinds\|memon wiki create\|memon wiki move\|memon wiki lint\|readonly'` | 26 passed, 65 intentionally unselected |
| `@memon/skills` | `vitest run src/wiki-kinds.test.ts src/index.test.ts` | 7 passed |
| `@memon/web` | `vitest run components/wiki-kind-help.test.tsx app/api/wiki/kinds/route.test.ts lib/auth/route-classes.test.ts components/wiki-shell.test.tsx` | 50 passed |

Total: **126 passed**. Core, CLI, Skills and Web typechecks passed. Core,
Backend, Skills, CLI and Web builds succeeded in isolation. Web was built once;
subsequent changes were schema validation refinement, CLI output/classification,
tests, documentation and formatting, with focused tests/typechecks rerun.

The config-only fixture registers `test-guide` without another production list:
Core recognition/lint and generated guidance, CLI create/move/lint/explain, and
API/Web ordering/help projections all pass. Fixture help edits propagate, and
malformed IDs/order/references/help/policies are rejected. Compatibility tests
lock existing status vocabularies, date/source requirements and advisory headings.

The compiled CLI also ran from an unrelated empty working directory: kinds list,
explanation and command help succeeded without journal warnings or new files.
An intentionally altered generated reference caused the drift command to fail
with regeneration guidance; its original bytes were restored afterward.

## Rendered UI

An ephemeral authenticated local server served an isolated build and generic
fixtures. The original running instance was untouched. The preview was stopped
after inspection.

- Chromium inspected all 11 entries against the actual registry API, including
  labels, IDs, purposes, distinctions and examples.
- Enter opened the guide; Escape and the Close button dismissed it; focus
  returned to the trigger. The unselected Wiki landing page also had the button.
- Desktop viewport 1440 × 1000: dialog 672 × 850 with working vertical scrolling.
- Mobile viewport 390 × 844: dialog width 358, 16px side margins, height 717.4;
  no dialog or document horizontal overflow. Scrolling reached initiative/catalog.
- Desktop and mobile screenshots were visually inspected. Initial missing CJK
  glyphs were isolated-browser font availability, fixed with a temporary font
  configuration outside the repository; screenshots were then rechecked.
- Anonymous registry API request returned 401; authenticated request returned
  the complete registry. Browser reported zero uncaught page errors.
- Authenticated served HTML contained the Help trigger. Compiled CSS contained
  the dialog sizing/scroll rules and background, foreground, popover,
  popover-foreground and muted-foreground tokens. White dialog background resolved.

## Handoff

Canonical config: `packages/core/src/wiki/kinds.json`.
Schema: `packages/core/src/wiki/kind-registry.ts`.
Edit/refresh/explicit migration instructions: `docs/wiki-kind-registry.md`.
New custom executable behavior and required heading enforcement are intentionally
not supported by schema version 1. Installed releases/skills require explicit
refresh; no live-update promise is made. Unrelated pending changes were not certified.

## Subsequent rollout authorization

The owner subsequently authorized deployment and push, including the existing
migration commits. This overrides the original no-rollout constraint for the
release phase only. Registry route ownership is explicitly registered in the
central API manifest. Figure and body-translation work remain excluded. Data
migration completion is coordinated with its owning task; the FS v6 marker and
the migration change's deferred final-release tasks remain unchanged.
