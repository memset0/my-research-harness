## Context

Three places render frontmatter tags as Badges in v3:
- `experiment-page.tsx:67` — exp detail header (currently `text-xs`).
- `experiment-card-grid.tsx:119` — exp card footer (currently
  `text-xs`).
- `experiment-page.tsx:349` — RunFrontmatterCard inside the run
  panel (already `text-[10px]`, set during bug 3).

The third site set a precedent. Aligning the first two with it is
purely cosmetic; no logic or accessibility consequences.

## Goals / Non-Goals

**Goals:**
- All v3 tag Badges render at `text-[10px]` so they read as compact
  metadata.

**Non-Goals:**
- Don't change the Badge primitive itself. Setting per-site classes
  preserves the Badge's reusability for other surfaces.
- Don't touch the Badge's `variant="outline"` color/border. Just the
  size token.
- Don't change spacing or `gap-1` between badges.

## Decisions

**D1. `text-[10px]` over `text-xs/relaxed` or shadcn's smaller
sizes.** `text-[10px]` is the literal value already used for the
run-panel frontmatter tags and labels in the same files (FmLabel,
FmField). Using a Tailwind arbitrary value is fine — it's
already a one-time codified token in this surface area.

## Risks / Trade-offs

- [Risk] On extremely high-density displays at small zoom, 10px
  tags may approach unreadability. → Mitigation: this is the same
  size already used on the run-panel side without complaint; the
  pattern is established.

## Migration Plan

Code-only edit. No data or schema migration.

## Open Questions

None.
