## ADDED Requirements

### Requirement: Skills teach agents to refresh the published index

The shared skill preflight SHALL give agents one index procedure, and the research, Wiki and Report skills SHALL point to it at the steps that write documents. The procedure SHALL state that:
- after any direct create, edit, move or delete of Experiment, Wiki or Report files, the agent runs plain `memon refresh` at the project source (the host that owns the files), and additionally `memon refresh <E…>` for Experiments whose results or records changed;
- `memon refresh --check` is an optional read-only aid for when the agent is unsure whether the index is current; skills SHALL NOT require it as a routine self-verification step;
- a refused refresh lists every invalid document; the agent fixes all of them and reruns, and reports any it cannot fix;
- `.memon/index/` is derived, ignored by Git, never committed and never edited by hand, and is rebuilt only by `memon refresh`;
- a website "Not refreshed" state means the source has the document but the index was not refreshed.

#### Scenario: Agent writes a Report bundle directly
- **WHEN** an agent following `memon-write-report` creates a new Report folder
- **THEN** it runs `memon refresh` and returns the link when the refresh succeeds, without a mandatory `--check` pass

#### Scenario: Refresh refuses
- **WHEN** `memon refresh` lists two invalid documents
- **THEN** the agent repairs both before rerunning, rather than repairing the first and retrying blindly
