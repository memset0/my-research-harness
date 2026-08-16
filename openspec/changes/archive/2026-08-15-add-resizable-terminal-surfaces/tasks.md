## 1. Resizable Surface Foundation

- [x] 1.1 Add validated, independently persisted drawer and split width preferences with viewport-aware bounds.
- [x] 1.2 Add a shared pointer- and keyboard-accessible terminal resize divider with focused component tests.

## 2. Terminal Presentation

- [x] 2.1 Refactor the root terminal provider so target state is independent from drawer/split presentation without changing existing drawer callers.
- [x] 2.2 Make the overlay drawer resizable and add controls to move the active target to split or popup.
- [x] 2.3 Add the docked right split shell, draggable divider, surface-switch controls, close behavior, and mobile drawer fallback.

## 3. Entry Points

- [x] 3.1 Add `Open in split view` to the shared Open With picker for tmux and Herdr defaults.
- [x] 3.2 Update component tests for integration filtering, split launch arguments, and existing drawer/popup behavior.
- [x] 3.3 Align Herdr's Open With icon treatment with the peer agent choices.

## 4. Verification and Release

- [x] 4.1 Run focused tests, TypeScript checks, production build, and strict OpenSpec validation.
- [x] 4.2 Deploy the verified build to the existing port 3737 production instance and smoke-test drawer, split, popup, tmux, and Herdr behavior.
