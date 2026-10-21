## ADDED Requirements

### Requirement: Skills teach agents to refresh and verify the published index

The shared skill preflight SHALL give agents one index procedure, and the research, Wiki and Report skills SHALL point to it at the steps that write documents. The procedure SHALL state that:
- after any direct create, edit, move or delete of Experiment, Wiki or Report files, the agent runs plain `memon refresh` at the project source (the host that owns the files), and additionally `memon refresh <E…>` for Experiments whose results or records changed;
- the agent verifies with `memon refresh --check` and confirms the new IDs in the published catalogs before reporting the work as visible;
- a refused refresh lists every invalid document; the agent fixes all of them and reruns, and reports any it cannot fix;
- `.memon/index/` is derived, ignored by Git, never committed and never edited by hand, and is rebuilt only by `memon refresh`;
- a website "Not refreshed" state means the source has the document but the index was not refreshed.

#### Scenario: Agent writes a Report bundle directly
- **WHEN** an agent following `memon-write-report` creates a new Report folder
- **THEN** it runs `memon refresh`, then `memon refresh --check`, and reports the Report as published only after the check passes

#### Scenario: Refresh refuses
- **WHEN** `memon refresh` lists two invalid documents
- **THEN** the agent repairs both before rerunning, rather than repairing the first and retrying blindly
