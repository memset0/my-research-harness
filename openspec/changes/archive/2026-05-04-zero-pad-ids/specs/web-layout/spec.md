## MODIFIED Requirements

### Requirement: SPA-style cross-page navigation between experiments and hypotheses

All cross-resource links (experiment → hypothesis, hypothesis → experiment, summary table → experiment, in-page TOC) SHALL use Next.js `<Link>` so navigation occurs without a full browser reload. Hash-only navigation (`#H<NNNN>`, `#motivation`) SHALL preserve the SPA boundary AND the browser SHALL scroll the target into view.

The hypothesis card anchor SHALL use the canonical padded id form: `<Card id="H0001">`. Cross-resource links SHALL emit the padded form. The web app SHALL NOT carry a client-side fallback for unpadded fragments — strict format everywhere.

#### Scenario: Click a hypothesis ref from experiment detail
- **WHEN** an experiment's `hypotheses` field lists `H0001` and the user clicks the `H0001` badge
- **THEN** the URL becomes `/p/<project>/hypotheses#H0001`, the navigation is client-side (no white flash / full reload), and the page scrolls so `<Card id="H0001">` is in view

#### Scenario: Click an experiment ref from hypothesis summary
- **WHEN** the summary row for `H0001` shows `foo-260501-100000` and the user clicks it
- **THEN** the URL becomes `/p/<project>/experiments/foo-260501-100000` via Next `<Link>` (no full reload)

### Requirement: Anchor ids for deep linking into experiment sections

Each section card on the experiment detail page (Motivation / Setup / Method / Result / Conclusion / Caveats / Artifacts / New Hypotheses / Resources) SHALL render with an `id` attribute matching the section name in lowercase kebab-case (`motivation`, `setup`, `method`, `result`, `conclusion`, `caveats`, `artifacts`, `new-hypotheses`, `resources`). This enables permalinks like `/p/<project>/experiments/<id>#method`.

Hypothesis cards on the hypotheses page SHALL render with an `id` attribute matching the hypothesis's canonical padded id (e.g. `<Card id="H0003">`).

#### Scenario: Permalink to a section
- **WHEN** the user pastes `/p/project-a/experiments/foo-260501-100000#method` into a new tab
- **THEN** the page loads and scrolls so the `Method` card is in view

#### Scenario: Permalink to a hypothesis card
- **WHEN** the user pastes `/p/project-a/hypotheses#H0003` into a new tab
- **THEN** the page loads and scrolls so the `<Card id="H0003">` for hypothesis H0003 is in view
