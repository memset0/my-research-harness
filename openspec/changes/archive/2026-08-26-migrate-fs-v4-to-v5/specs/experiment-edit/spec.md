## ADDED Requirements

### Requirement: `POST /api/open-claude-code` returns the experiment folder for exp targets

When `POST /api/open-claude-code` receives a `{ kind: 'exp', id }` payload, the response's `cwd` SHALL be the experiment's **folder** path (`<projectRoot>/docs/experiments/E<NNNN>-<slug>/`), not the `README.md` file path. This lets an agent dropped into the cwd via `cd <cwd> && claude` land inside the experiment's local scratch space, with the README as a sibling of any user-owned helpers.

For `{ kind: 'run', id }` payloads, the behavior is unchanged (the run dir is the cwd).

#### Scenario: open-claude-code returns folder cwd for an exp
- **GIVEN** an experiment `E0001-foo` whose README is at `<projectRoot>/docs/experiments/E0001-foo/README.md`
- **WHEN** `POST /api/open-claude-code` is called with `{ kind: 'exp', id: 'E0001-foo' }`
- **THEN** the response's `cwd` field equals `<projectRoot>/docs/experiments/E0001-foo` (the folder)
- **AND** the response's `command` field references `cd <cwd> && claude` using that folder
- **AND** the response's `hint` mentions that user-local helpers in the folder (smoke scripts, etc.) are accessible from the spawned shell

#### Scenario: open-claude-code unchanged for runs
- **GIVEN** a run `foo-260502-110000`
- **WHEN** `POST /api/open-claude-code` is called with `{ kind: 'run', id: 'foo-260502-110000' }`
- **THEN** the response's `cwd` is the run dir (unchanged from pre-v5 behavior)
