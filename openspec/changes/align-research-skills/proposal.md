## Why

The lightweight CLI is shipped, but bundled instructions still prescribe removed commands and duplicate research bookkeeping. Agents need a consistent small workflow that leaves experiments understandable to a human reader without requiring narrated execution logs.

## What Changes

- Align all shipped Skill entrypoints and references with the current CLI and direct-file editing contracts; preserve the seven existing Skill roles.
- Make the research explanation readable independently of chat: question, comparison, selected evidence, current interpretation and material limits, without fixed headings or per-Run prose.
- Replace obsolete optional phase-document help with usable schema guidance, and generate Wiki guidance without retired command pointers.
- Document scoped cleanup of project instructions and rejection of legacy launchers before they create old-format Runs. Launcher upgrades and research-data conversion remain separate work.

## Capabilities

### New Capabilities

### Modified Capabilities

- `memon-skills`: current command guidance, lightweight human-readable experiments, and scoped legacy-launcher handling.
- `memon-wiki-skill`: current creation, reading and direct-edit guidance without old field-edit/lint commands.

## Impact

Bundled Skills, optional references, the Wiki kind-guidance generator, repository instruction pointers and focused verification. Project-specific cleanup and launcher paths remain outside this public repository. No filesystem version change, Skill merge, automatic research migration or monitor transport implementation.
