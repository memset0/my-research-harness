## Why

The pre-refactor CLI registered 90 commands, including 51 hidden compatibility commands. Hiding commands has not removed the cost of learning and maintaining overlapping file-editing workflows. Research agents need allocation, coordinated Run transitions, publication and useful reads; ordinary file editing needs no dedicated command per field.

## What Changes

- **BREAKING**: remove 58 redundant spellings. The six routine operations are `experiment create`, `run create`, `run update`, `refresh`, `show` and `install-skills`; retained operational and historical commands remain available under `memon`.
- Defer moving the 12 operational/optional and 14 historical commands to independent binaries. Restore their `memon …` paths, keep one installed binary, and describe all 32 retained leaves accurately.
- Make `show` the inventory and targeted Experiment/Run/Wiki reader, including result projections and diagnostics. Inventory reads the published index instead of repeatedly scanning Run directories.
- Initialize a genuinely new research project on first Experiment creation; never infer migration of existing research from a missing marker.
- Validate during creation, reads and refresh. Agents edit Markdown/JSON/CSV directly and publish once, without manual journal receipts or repeated lint ceremonies.
- Preserve the seven bundled Skill entrypoints and their responsibilities. Skill consolidation is explicitly excluded; any command-reference corrections require the user's separate clarification.

## Capabilities

### New Capabilities
- `minimal-research-cli`: the definitive small command surface, retained optional/legacy commands, unified reads and integrated publication checks.

### Modified Capabilities
- `memon-cli`: replace the single broad binary contract and retire redundant command registrations.
- `wiki-cli`: optional Wiki allocation/move/migration and unified reading replace per-field CLI authoring.
- `lightweight-execution-workflow`: publication/read diagnostics replace a separate mandatory lint step.

## Impact

CLI registration, command adapters, installation/update entrypoints, focused tests and current usage documentation change. Shared domain services and historical file readers remain available to the website. FS11 formats, results aggregation semantics, central hosting, Wiki formats and the seven Skill roles are unchanged. No research-project migration or data deletion is included.
