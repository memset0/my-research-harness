## Why

The pre-refactor CLI registered 90 commands, including 51 hidden compatibility commands. Hiding commands has not removed the cost of learning and maintaining overlapping file-editing workflows. Research agents need allocation, coordinated Run transitions, publication and useful reads; ordinary file editing needs no dedicated command per field.

The current simplification program stays within major version 11. Memon should provide a lightweight viewing and access layer for agent-managed research; agents remain free to organize analysis and build their own reports and websites.

## What Changes

- **BREAKING**: remove 71 redundant or retired spellings. The six routine operations are `experiment create`, `run create`, `run update`, `refresh`, `show` and `install-skills`; retained operational and historical commands remain available under `memon`.
- Defer moving the retained operational/optional commands to independent binaries. Keep one installed binary and describe all 19 retained leaves accurately.
- Make `show` the inventory and targeted Experiment/Run/Wiki reader, including result projections and diagnostics. Inventory reads the published index instead of repeatedly scanning Run directories.
- Initialize a genuinely new research project on first Experiment creation; never infer migration of existing research from a missing marker.
- Validate during creation, reads and refresh. Agents edit Markdown/JSON/CSV directly and publish once, without manual journal receipts or repeated lint ceremonies.
- Remove the 11 legacy version/schema/binding/Variant/Run-rename/Run-archive leaves and the two migration leaves. Preserve historical readers; use scoped migration scripts under `packages/core/migrations/scripts/` rather than retaining old write interfaces.
- Refresh the concise migration Skill and shipped guides to invoke those scripts. Keep the seven Skill entrypoints; general Skill consolidation remains separate.

## Capabilities

### New Capabilities
- `minimal-research-cli`: the definitive small command surface, retained optional/legacy commands, unified reads and integrated publication checks.

### Modified Capabilities
- `memon-cli`: replace the single broad binary contract and retire redundant command registrations.
- `wiki-cli`: optional Wiki allocation/move/migration and unified reading replace per-field CLI authoring.
- `lightweight-execution-workflow`: publication/read diagnostics replace a separate mandatory lint step.

## Impact

CLI registration, command adapters, installation/update entrypoints, focused tests and current usage documentation change. Shared domain services and historical file readers remain available to the website. FS11 formats, results aggregation semantics, central hosting, Wiki formats and non-migration Skill roles are unchanged. No research-project migration or data deletion is included.
