## 1. Clipboard Bridge

- [x] 1.1 Generalize the ttyd iframe event bridge so clipboard behavior is attached for every terminal source while preserving manage-page navigation forwarding.
- [x] 1.2 Add explicit iframe clipboard permission and conventional copy-shortcut handling without intercepting plain Ctrl+C.

## 2. Native xterm Selection

- [x] 2.1 Preserve native xterm mouse behavior and avoid a separate Copy mode.
- [x] 2.2 Document `Shift+drag` as xterm's native select-and-auto-copy gesture while TUI mouse reporting is active.
- [x] 2.3 Preserve iframe reload and listener cleanup behavior.

## 3. Verification and Release

- [x] 3.1 Add focused tests for permissions, shortcuts, native mouse behavior, and existing manage navigation.
- [x] 3.2 Run focused regression tests, TypeScript checks, production build, and strict OpenSpec validation.
- [x] 3.3 Deploy the verified build to port 3737 and smoke-test tmux, Herdr, proxy access, and the native-copy client bundle.
