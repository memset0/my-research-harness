## MODIFIED Requirements

### Requirement: Run-panel actions inside the exp detail page

Each expanded run panel inside the exp detail page SHALL provide three
actions:
- `Edit markdown (run)` — opens the markdown editor on the run's README
  (uses `run-edit`'s save handshake)
- `Open Claude Code (run)` — opens at the project root with a hardcoded
  preset prompt naming the run dir and parent exp doc paths
- `Archive` — writes `<run-dir>/.archived` and removes the run from the
  expanded panel set

The exp-level action bar at the top of the page SHALL provide:
- `Edit markdown` — opens the editor on the exp doc
- `Open Claude Code` — opens at the project root with a preset prompt
  naming the exp doc path and the list of member run dirs

The web load path for the run README inside `Edit markdown (run)`
SHALL go through an id-addressed helper that derives the absolute
`README.md` file path from the run dir before reading it. The helper
SHALL NOT pass the run directory itself to the legacy
`/api/readme?path=…` endpoint — that endpoint expects a file path
and returns `EISDIR` when handed a directory.

#### Scenario: Run-panel Edit operates on run README
- **WHEN** the user clicks `Edit markdown (run)` inside the panel for
  `bar-260501-100000`
- **THEN** the editor opens with the content of
  `<projectRoot>/<...>/bar-260501-100000/README.md`, and Save POSTs to
  `/api/runs/bar-260501-100000/readme`

#### Scenario: Run README load uses id-addressed helper, not raw run path
- **GIVEN** a run dir whose `Run.path` is the directory itself (the v3
  shape)
- **WHEN** the user clicks `Edit markdown (run)`
- **THEN** the editor's load helper resolves the run dir via
  `GET /api/runs/:id`, joins `/README.md`, and reads the resulting
  file path — and the resulting `Could not load README` error path
  is NOT triggered (the legacy `EISDIR` regression must not return)

#### Scenario: Open Claude Code preset prompts differ
- **WHEN** the user clicks the run-panel `Open Claude Code` button
- **THEN** the preset prompt names the run dir path and the exp doc
  path, distinct from the exp-level button's prompt which names the exp
  doc path and the run list
