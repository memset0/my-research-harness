## 1. Content model

- [x] 1.1 Add shared metadata/manifest parsing and legacy-compatible Wiki/Report discovery; default new Wiki creation to free-form README folders and verify manifest-only, classified and malformed fixtures.
- [x] 1.2 Carry metadata through indexed Backend/API reads, contained assets and locked writes; verify round trips, duplicate IDs and path escapes.

## 2. Service forwarding

- [x] 2.1 Implement authenticated local/SSHFS HTTP and WebSocket forwarding with lazy tunnels; verify streaming, prefix handling, offline recovery and credential stripping.
- [x] 2.2 Add independently granted File Agent forwarding and central transport; verify mTLS, source identity, port restrictions and real local-agent transport parity.

## 3. Reading and authoring

- [x] 3.1 Add category/freshness/presentation navigation and direct HTML/service detail with bounded on-demand health; verify rendered desktop/mobile views and existing Markdown.
- [x] 3.2 Update concise Wiki/Report Skills and references to the implemented contract; verify generated checks and installed authoring workflow.
- [x] 3.3 Prepare private per-document migration inventory and linked HTML preview; verify source content is unchanged and historical destinations are explicit.

- [x] 3.4 Add guarded wiki deletion with shared reference resolution, precise blockers, contained/locked removal and inventory refresh; verify cross-document references, assets, concurrent edits and failure atomicity.

## 4. Integration

- [x] 4.1 Run focused regression tests, typecheck and OpenSpec validation; verify exact-build content rendering and all three service transports without running a full routine suite.
