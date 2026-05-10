## MODIFIED Requirements

### Requirement: Experiment-doc detail page (v3)

The route `/p/<project>/e/<E-id-slug>` SHALL render an experiment detail
page with this layout:
- **Header bar**: title, aggregate status pill, effective times, tags,
  hypothesis-ref chips
- **Action bar**: `Edit markdown` (opens the editor on the exp doc),
  `Open Claude Code` (opens project root with exp-scoped preset prompt
  per `experiment-edit`)
- **Body markdown**: rendered `Motivation` / `Method` / `Plan` /
  `Conclusion` / `Caveats` / `Warnings` (in this order; the warnings
  table renders inline with the Run column)
- **Runs section header**: `Runs (<count>)`
- **Run panels**: one expandable panel per confirmed member run

The `Plan` section SHALL render as a Card (parallel to the other body
sections) using the same markdown renderer. The renderer SHALL display
GFM task list markers (`- [ ]` / `- [x]`, `* [ ]` / `* [x]` synonyms
also accepted) as native HTML checkboxes (`<input type="checkbox">`)
at every nesting depth supported by GFM. Checkboxes SHALL render in
the **disabled** state in v1 — clicking them SHALL NOT toggle their
state and SHALL NOT issue any network request. Toggling Plan items is
done via the existing `Edit markdown` dialog.

When the `Plan` section body is null/empty, the Card SHALL render a
placeholder (consistent with how other empty body sections are
rendered today) so the user sees that the section exists and is
editable.

Run panels SHALL be expanded by default (per the design discussion's
Q13 decision). The set of expanded panels SHALL be persisted in URL
hash and `localStorage` (key `memon:exp-page:<exp-id>:expanded`) so a
reload preserves the user's most-recent toggle state.

When the URL has `?run=<run-dir>`, that run's panel SHALL be expanded
on initial render and the page SHALL scroll to it.

#### Scenario: All run panels open by default on first visit
- **GIVEN** an experiment with 3 confirmed runs and no prior
  `localStorage` toggle state
- **WHEN** the user opens the exp detail page
- **THEN** all 3 run panels are rendered expanded

#### Scenario: ?run= query param expands and scrolls
- **GIVEN** the same experiment
- **WHEN** the URL is `/p/<project>/e/<exp-id>?run=run-2`
- **THEN** all 3 panels are expanded; the page scrolls to `run-2`'s
  panel

#### Scenario: Toggled-collapse persists across reload
- **GIVEN** the user collapsed the panel for `run-1`
- **WHEN** the user reloads the page
- **THEN** `run-1` is still collapsed; the others are still expanded

#### Scenario: Plan section renders nested task list with read-only checkboxes
- **GIVEN** an experiment doc whose `## Plan` body is:
  ```
  - [x] Run baseline at LR=1e-4
    - converged but loss plateaued early
  - [ ] Try LR=3e-4 + warmup
    - [ ] Sweep batch size [32, 64, 128]
  ```
- **WHEN** the user opens the exp detail page
- **THEN** the Plan Card renders three `<input type="checkbox">`
  elements, the first checked and all three with the `disabled`
  attribute set; the nested list visually indents the inner items;
  the reflection text under the first task renders as a sub-bullet

#### Scenario: Click on rendered checkbox is a no-op
- **GIVEN** the Plan Card rendered as in the previous scenario
- **WHEN** the user clicks the unchecked checkbox next to "Try LR=3e-4
  + warmup"
- **THEN** the checkbox state does not change, no network request is
  issued, and the only path to toggle is through the `Edit markdown`
  dialog

#### Scenario: Plan Card renders placeholder when section is empty
- **GIVEN** an experiment doc whose `## Plan` section is absent or
  whose body is empty
- **WHEN** the user opens the exp detail page
- **THEN** the Plan Card renders the same empty-section placeholder
  treatment as `Method` / `Conclusion` / `Caveats` show today when
  empty
