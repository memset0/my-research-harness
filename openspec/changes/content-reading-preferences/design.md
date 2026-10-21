## Context

The existing environment switch rejects translation API work, but the owner component always mounts its controls and readiness probe. Runtime configuration already passes safe server-selected options to SSR and browser components. HTML manifest descriptions are parsed today; the missing contract is author guidance.

## Goals / Non-Goals

Expose only the translation enablement boolean to the browser and prevent disabled translation from mounting. Preserve provider checks and cached/source data. No provider compatibility repair, new endpoint, filesystem change or mandatory description validation.

## Decisions

- Add an optional translation enablement field to the existing runtime payload, defaulting to false when missing or malformed. The server uses the existing `MEMON_TRANSLATION_ENABLED === '1'` check.
- Split the translation boundary from its enabled implementation. Disabled pages return the original children before mounting translation state/effects, preventing control flashes and keyboard/probe work. Hiding controls after a failed readiness response would still cause flashes and unnecessary requests.
- Add the description rule and example to the shared HTML/maintenance references used by both authoring Skills. Keep the parser backward compatible.

## Risks / Trade-offs

- Runtime configuration is captured on page load → enabling again requires a serving-process restart and page reload, matching the existing environment configuration.
- Component tests historically assumed translation was always enabled → explicitly opt the translation behavior tests in and add disabled/reenabled coverage.

## Migration Plan

No data migration. Ship the runtime flag and guidance, then use the existing environment setting for operator-selected instances. Restore that setting to re-enable translation; source documents and translation caches remain intact.
