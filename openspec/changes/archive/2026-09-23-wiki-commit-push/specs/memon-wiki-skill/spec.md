## ADDED Requirements

### Requirement: Wiki changes are committed per batch of the agent's own pages and pushed

The skill SHALL commit only when a batch of page changes reaches a stopping point: while an experiment the pages depend on is still running or pending, or a question to the user is awaiting an answer that would change the pages, it SHALL leave the edits uncommitted unless the user asks for a version to be committed now. At a stopping point it SHALL commit that batch of related page changes as one `memon wiki commit <page>...` naming exactly the pages the agent changed in that batch, SHALL commit unrelated batches separately, SHALL never include pages or files changed by others, and SHALL rely on the command's automatic push. The handoff SHALL report each commit's SHA and push result; on `PUSH_FAILED` the skill SHALL report the SHA and reason and SHALL NOT fetch, rebase, merge, or force on its own.

#### Scenario: Finding plus roadmap
- **WHEN** the agent records a finding W0024 and links it from roadmap W0012 in one task
- **THEN** it runs one `memon wiki commit W0024 W0012 -m ...` and reports the pushed SHA

#### Scenario: Another agent's edit in the tree
- **GIVEN** W0013 was modified by another agent in the same working tree
- **WHEN** this agent commits its W0012 change
- **THEN** W0013 is not part of the commit

#### Scenario: Work waits on an experiment
- **GIVEN** the agent updated W0012 and the result it will cite is still being produced
- **WHEN** it hands off to wait for the experiment
- **THEN** the edit stays uncommitted and the handoff says so and why

#### Scenario: User asks for a snapshot
- **WHEN** the user asks to commit the current version while questions remain open
- **THEN** the agent commits and pushes the pages it changed
