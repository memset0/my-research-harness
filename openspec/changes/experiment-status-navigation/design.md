## Context

See proposal.md. The grid already reads projected displayStatus from Experiment summaries. Sidebar currently uses identity inventory only. Both project-qualified query keys and the sidebar read-intent gate must remain intact. Existing lifecycle computation is owned by experiment-research-versions.

## Goals / Non-Goals

**Goals:** Make lifecycle groups scanable and consistent across both surfaces; improve title readability, search and navigation to less-active work.

**Non-Goals:** Change state semantics, infer scientific status, edit research data, add new persistence/API contracts or fetch per-Experiment details/Results from navigation.

## Decisions

- Use one browser-safe grouping helper with type-only API imports. It consumes existing summaries and inventory fallback; never imports core runtime. Modern group keys use persisted status while badges use projected displayStatus. Legacy archived entries have a separate historical group without mapping RESOLVED/ABANDONED to modern states.
- The list offers lifecycle buttons with global counts, search and a separate progress selector. Groups own accessible shadcn Collapsible triggers. ACTIVE/PAUSED open initially; ARCHIVED/RETIRED close initially. Search or explicit filters force matching groups visible. Remove the redundant show-archived checkbox and its browser preference from this surface.
- Sidebar retains inventory for immediate/failure navigation and adds the existing summaries query with the same enabled gate, sharing cache with the list/detail surfaces. Missing summaries appear under Status unavailable, not ACTIVE. Group controls and rows stay within the current scroll/resize layout; do not fork Sidebar primitives. Current archived/retired destinations force their group open.
- Rows show a short E-number, full title (wrapping or tooltip), and a compact icon/status label. Cards use readable two-line titles and a single updated timestamp; preserve tags and inactive-running warnings. Sorting is running first, then updated descending, then ID, shared across surfaces.

## Risks / Trade-offs

- Rich sidebar status costs more than an identity listing → use existing cached summary endpoint only for expressed read intent, retain fallback, no per-item requests.
- Historical work could become hard to find → visible group counts, search across all groups and automatic deep-link reveal.
- Legacy projects lack modern lifecycle → retain original statuses explicitly and test legacy archive handling.

## Migration Plan

Central-only release; no project writes or filesystem conversion. Validate focused UI tests, typecheck and rendered desktop/mobile/keyboard behavior in a neutral preview, then deploy the exact release. Rollback uses the preceding central release; project data is unchanged.
