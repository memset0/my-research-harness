## 1. Configuration and capability gating

- [x] 1.1 Add backward-compatible `terminal.tmux_enabled` and opt-in
  `terminal.herdr.cli` schemas, resolved types/defaults, loader coverage, and
  example configuration.
- [x] 1.2 Serialize terminal integration enablement to the browser and add
  client parsing/default tests.
- [x] 1.3 Guard tmux-only pages and APIs before discovery/mutation work while
  preserving all enabled/default behavior.

## 2. Herdr backend and ttyd lifecycle

- [x] 2.1 Generalize terminal-manager metadata for peer ttyd backends and add a
  stable, deduplicated Herdr ttyd entry without changing tmux argv behavior.
- [x] 2.2 Implement bounded no-shell Herdr CLI execution, startup retry, exact
  workspace-label lookup, focus, create-and-focus, and per-target
  serialization.
- [x] 2.3 Add the owner-only Herdr start API with project/experiment/run cwd
  resolution, validation, error mapping, and response parity with terminal
  start.
- [x] 2.4 Add manager and route tests for Herdr spawn, reuse, create/focus,
  concurrency, failure, cleanup, and disabled configuration.

## 3. Drawer, popup, Open-with, and sidebar UI

- [x] 3.1 Add Herdr mode to API client types, `TerminalView`, root drawer state,
  lifecycle copy, and popup query handling.
- [x] 3.2 Extend the unified Open-with persisted selection and menu to list only
  enabled backends and create/focus Herdr targets.
- [x] 3.3 Add owner-only sidebar drawer/popup launchers and config-gate the
  existing Manage tmux footer link.
- [x] 3.4 Add component/page tests for mixed, Herdr-only, tmux-only, disabled,
  viewer, drawer, and popup behavior.

## 4. Verification and deployment

- [x] 4.1 Run focused core/web tests, typechecks, lint checks for touched files,
  and production builds; strictly validate the OpenSpec change.
- [x] 4.2 Enable the configured Herdr CLI in the production instance while
  preserving tmux, replace the current 3737 deployment through its existing
  supervisor, and verify health plus Herdr and tmux smoke paths.
