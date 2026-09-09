## Context

Core has separate kind/status/heading declarations and special-case required fields; Web duplicates order to avoid importing filesystem-dependent Core runtime. Skills duplicate descriptions and policies.

## Goals / Non-Goals

**Goals:** Make ordinary taxonomy edits declarative, preserve diagnostic and lifecycle behavior, and expose matching human/agent guidance.

**Non-Goals:** Custom executable capabilities, project overrides, page rewrites, production changes, or completion of unrelated active changes.

## Decisions

- Use a JSON file in Core with a strict Zod schema. Static JSON import ships via TypeScript compilation and avoids cwd-dependent reads. The browser imports only the JSON-only package subpath, never Core JavaScript; build checks validate it. This avoids a duplicate generated frontend enum or an extra network dependency for navigation/help.
- Derive compatibility exports for kind order, status vocabularies and recommended headings; use policy fields for date/source requirements. Empty status means existing ignore/no-default behavior. Recommended headings remain warnings and creation templates, not required structure.
- Expose a central authenticated kind metadata API and focused `wiki kinds ls|show` commands independent of project resolution.
- Generate the kind-specific English reference from the validated registry. Keep shared safety/workflow content separate. Explicit generation writes the reference; build/packaging checks fail on drift instead of silently modifying source.
- Compose existing Dialog, Tooltip and Button with the existing help icon. Render concise Chinese entries with stable IDs and scrollable content.

## Risks / Trade-offs

- Different installed releases can expose different registries → document build, install, skill refresh, and separately authorized runtime restart requirements.
- Policy changes can invalidate existing pages → preserve reads and surface diagnostics; no implicit migrations or review writes.
- Concurrent unrelated work → retain changes and verify in an isolated local checkout/server, without switching the running production instance.

## Migration Plan

No migration runs in this task. Operators validate/generate/build updated packages and explicitly refresh installed skills. Existing pages retain identity; later reclassification uses `wiki move` with explicit status handling. Registry removals leave unknown kinds readable. Production rollout requires separate authorization.
