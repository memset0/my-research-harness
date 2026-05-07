## ADDED Requirements

### Requirement: Tag typography on v3 exp surfaces

Tag Badges (`#foo`, `#bar`, …) on v3 exp surfaces SHALL render at
`text-[10px]` so they read as compact metadata rather than
competing with primary labels (the page title, the monospace E-id,
section headings). This applies to:

- The exp detail page header tag list
  (`apps/web/components/experiment-page.tsx`).
- The exp card grid footer tag list
  (`apps/web/components/experiment-card-grid.tsx`).
- The run-panel frontmatter card tag list (already at
  `text-[10px]` since the bug-3 run-panel rich port).

#### Scenario: Tags on the exp detail page header are compact
- **WHEN** the user opens `/p/<project>/e/<exp-id>` for an exp doc
  whose frontmatter has tags
- **THEN** the rendered tag Badges carry the className
  `text-[10px]` (NOT `text-xs`)

#### Scenario: Tags on the exp card grid are compact
- **WHEN** the user opens `/p/<project>` and the project has at
  least one exp doc with tags
- **THEN** the rendered tag Badges in each card's footer carry
  `text-[10px]`
