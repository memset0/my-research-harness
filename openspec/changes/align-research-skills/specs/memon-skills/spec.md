## ADDED Requirements

### Requirement: Lightweight research instructions match the installed interfaces
Bundled research instructions SHALL use the supported creation, Run-update, show and refresh interfaces. Ordinary metadata, narrative and metrics SHALL be editable as files. Shared guidance SHALL NOT prescribe removed initialization, version-check, binding, per-field editing or lint commands. Optional structured tracking SHALL supply usable format guidance without requiring a retired command. These instructions supersede historical skill-specific command sequences for FS11 work; historical readers and scoped migration guidance remain available.

#### Scenario: Fresh research project
- **WHEN** an agent follows the bundled research instructions in an empty research namespace
- **THEN** it can create an experiment and READY Run, inspect the published parameters, update execution state and refresh direct edits using installed commands
- **AND** it needs no manual registry row, Run README, binding list or phase checklist

### Requirement: Experiment explanations support independent human reading
The research Skill SHALL require a concise explanation of the question, comparison, selected evidence, current interpretation and meaningful limitations when applicable. It SHALL permit free organization and references to native evidence or visual reports. It SHALL NOT require a fixed heading sequence, prose for every Run or a second copy of generated result tables. Explanations SHALL be revised when understanding changes rather than on every execution event.

#### Scenario: Several routine Runs finish
- **WHEN** completion adds measurements without changing the research interpretation
- **THEN** the agent publishes execution/results records without appending repetitive narrative
- **AND** the existing explanation and evidence links remain understandable independently of the conversation

### Requirement: Obsolete launchers are upgraded only within authorized scope
Research instructions SHALL require agents to inspect an existing launcher's output convention before reuse. A launcher explicitly disabled for an obsolete convention SHALL remain disabled until the user authorizes its upgrade and the updated flow is verified. A disabled entry SHALL fail before allocating directories, jobs or processes, with the supplied explanation; it SHALL have no bypass option. Historical outputs and analysis-only readers SHALL remain accessible.

#### Scenario: Disabled legacy entry
- **WHEN** an agent invokes an entry disabled under the project rollout
- **THEN** it exits unsuccessfully before launch side effects and explains that upgrading requires discussing the convention with the user
- **AND** the agent does not remove the guard merely to finish its current task

### Requirement: Reports preserve a declared evidence horizon
The Report Skill SHALL author time-scoped research views with creation/update times, an explicit evidence cutoff and relevant code revisions or an honest statement of missing provenance. Nearby corrections or extensions MAY update the same Report, preserving creation time and advancing the evidence cutoff only when its evidence changes. Staleness SHALL be distinct from incorrect measurements and SHALL NOT be inferred only from age. An interactive Report SHALL not silently substitute current results for its declared evidence horizon.

#### Scenario: Refreshing a recent report
- **WHEN** an agent adds measurements to a recent Report about the same question
- **THEN** it may keep the Report identity, update its content time and evidence cutoff, and retain meaningful corrections without creating a new Report for every edit

### Requirement: Presentation does not prescribe research authoring
Wiki and Report Skills SHALL allow direct HTML artifacts and websites using the agent's chosen layout and tools. Markdown and components SHALL be optional presentation mechanisms. The agent SHALL own generation, regeneration and service lifecycle; memon SHALL be described as the rendering/access layer. Guidance SHALL accurately separate installed reader requirements from proposed manifest-only entries and proxy capabilities.

#### Scenario: HTML report
- **WHEN** an agent produces an HTML report
- **THEN** it uses the HTML as the substantive report without a mandatory duplicate Markdown explanation, keeping only the adapter needed by the installed reader
