## 1. Remove the subsystem

- [x] 1.1 Remove Core/Backend hypothesis parsing, reads, routes, references and implicit writes; verify ordinary project/Wiki reads and rename do not access or alter the old file.
- [x] 1.2 Remove Web navigation, pages, panels, cache/heartbeat/prewarm and API wiring; verify routes/query policies and desktop/mobile rendering.
- [x] 1.3 Remove CLI authoring/output and current documentation requirements while retaining inert history; verify creation, legacy readability and unchanged historical bytes.

## 2. Verify integration

- [x] 2.1 Run focused regression tests, typecheck, generated-document checks and OpenSpec validation; verify an exact production build and legacy project browsing without migrating source files.
