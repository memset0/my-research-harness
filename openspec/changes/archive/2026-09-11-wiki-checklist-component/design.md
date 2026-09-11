## Context

See proposal.md for motivation. Registered components are central-only descriptors plus shared React renderers. `WikiDocumentView` is used by full-page and side-pane Wiki surfaces; `putWikiPage` already enforces authorization, read-only project configuration, path containment, mtime/hash optimistic locking, and returns the written page. The component authoring skill reads the central manual, so field-level Agent policy belongs there rather than in duplicated skill text.

## Goals / Non-Goals

**Goals:** Preserve one file as truth; no transient success masquerading as a saved check. Keep unrelated bytes outside the selected block intact. Reuse existing UI primitives, page writes, and query keys. Preserve concurrent changes already present in shared source files.

**Non-Goals:** New database, checklist service, arbitrary-document write API, automated parent aggregation, enforced ordering between human flags, automatic Wiki review marks, or project read-only configuration changes. Other Markdown surfaces render but do not gain new write endpoints.

## Decisions

1. YAML uses `items: [{title, content?, status?, children?}]`; each status field is independently optional/default false. Empty content may be absent, null or an empty string; empty children may be absent, null or `[]`. Accept an empty root list. Reject aliases to prevent cycles and ambiguous multi-item edits. Use the existing YAML dependency and descriptor diagnostics; strict validation avoids coercing strings into booleans.
2. Derive dotted numbering from sequence positions. Keep children visible and collapse only content. Use shadcn Checkbox, Label, Button/Collapsible rather than forking primitives. Treat content as display text with preserved line breaks, not executable HTML or another writable nested component document.
3. Carry block source line/payload identity from the shared Markdown fence handling into the renderer. A narrowly scoped Wiki checklist context supplies the displayed full-document snapshot, mutation callback and pending state. Standalone rendering has no mutation context and is read-only. Source positions address duplicate blocks; payload matching guards stale or mismatched positions.
4. A pure source updater selects the actual fenced block, validates its payload and recursive item path, and changes one state through YAML document editing. Preserve comments where supported, block fence and indentation, and all bytes outside that block. Unknown input is rejected, not rewritten approximately. Frontmatter offset is accounted for when mapping rendered body lines to the full file.
5. The Wiki context calls existing `putWikiPage` with the original snapshot's mtime/hash. It waits for server success before accepting the new page and updates existing TanStack detail/list keys. Disable status interaction during saving; conflicts offer reload without blind retry. Existing backend read-only restrictions remain authoritative and are surfaced honestly.
6. Human authorization is explicit authoring policy in the registry manual and is followed when writing real examples. The UI is an owner action, not an Agent identity detector. No filesystem-only schema can prove who edited a boolean; do not claim it can.
7. This is a central-only component release. Registry manual changes do not require distributing a new managed skill. No new dependency or filesystem migration is needed. Interpret the user's numbering typo as bold numbering.

## Risks / Trade-offs

- Source positions may be transformed by Markdown plugins → carry original fence identity and reject mismatches; test duplicate blocks, nested paths, frontmatter, fenced examples and CRLF.
- Sequential human clicks can race document refresh → pending guard, original-snapshot lock, cache update on success, explicit conflict reload.
- Existing configured projects may be read-only → do not change deployment policy; demonstrate real persistence on a neutral writable fixture and clearly report real-project write rejection. Verified: the central project is `read_only`, its page write answers `409 UNSUPPORTED_CAPABILITY`, so the client distinguishes the server `CONFLICT` code (reload offer) from every other rejection (plain failure toast, checkbox unchanged).
- Shared working tree contains unrelated figure/translation changes that the checklist files import (`figure@1` registry entry, `BodyTranslation`) → the checklist cannot be committed or released in isolation without also publishing that work. Verification ran on an isolated production build of the whole working tree on a loopback port; release/archive waits for an explicit decision on those sibling changes.

## Migration Plan

Register `checklist@1`, verify the component and source update path with targeted tests and actual desktop/mobile browser interaction, and update the requested Wiki home with a real all-false/honestly completed example. Older services show the pinned block as code until the central release is deployed. No document migration or remote-node installation is needed. Preserve the previous production artifact for rollback; never rebuild over a live output directory.
