## MODIFIED Requirements

### Requirement: Top AppBar with view tab switcher

The dashboard SHALL render a sticky **AppBar** above the main content area containing:
- The memon brand on the left
- A `Tabs`-style switcher for `Experiments` / `Hypotheses` / `Journal` (plus `Reports` / `Digests` once those tabs are present), scoped to the current project
- Each tab label SHALL be followed by a small **count badge** showing the total number of items of that kind in the current project (experiments → list length, hypotheses → entries length, journal → total events, reports → list length, digests → list length). The badge SHALL render `0` as a faint "0" (not hidden), and a skeleton pulse while the underlying query is loading. The badge SHALL use `tabular-nums` so digits don't shift width as the count changes
- Each tab SHALL include a **reserved slot** (data-attribute `data-slot="warnings"`) immediately to the right of the count badge for a future warnings indicator. In this change the slot SHALL be empty (rendered as a placeholder span with no children); a future change populates it
- A `+ New experiment` action on the right

#### Scenario: Tab navigation
- **WHEN** the user is on `/p/project-a/experiments/foo-260501-100000` and clicks the `Hypotheses` tab in the AppBar
- **THEN** the URL updates to `/p/project-a/hypotheses`; the AppBar's `Hypotheses` tab is now active

#### Scenario: New experiment from AppBar
- **WHEN** the user clicks `+ New experiment` while on any view of `project-a`
- **THEN** the existing new-experiment modal opens with `project-a` pre-selected

#### Scenario: Count badges show live totals
- **GIVEN** project-a has 14 experiments, 6 hypotheses, and 142 journal events
- **WHEN** the user is on any per-project view
- **THEN** the AppBar shows `Experiments 14`, `Hypotheses 6`, `Journal 142` (each count rendered as a subordinate badge next to the label)

#### Scenario: Count of zero is visible, not hidden
- **GIVEN** a project with zero hypotheses
- **WHEN** the AppBar renders for that project
- **THEN** the Hypotheses tab still shows the count badge with the digit `0` (faint), so the user sees the absence

#### Scenario: Loading state shows skeleton, not "0"
- **WHEN** the underlying React Query for any kind is `isLoading` (no cached data yet)
- **THEN** the count badge for that tab renders a small pulse skeleton instead of `0`, avoiding a flash of zero before the real value arrives

#### Scenario: Reserved warnings slot is present but empty
- **WHEN** inspecting the rendered DOM of any tab
- **THEN** there is a span with `data-slot="warnings"` adjacent to the count badge
- **AND** that span has no children (no warning indicator) — this is a hook for a later warnings-system change to fill in
