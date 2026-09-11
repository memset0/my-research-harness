# wiki-checklist-component Specification

## Purpose

Define a recursive YAML checklist whose Agent completion, human awareness, and human review remain independent, with compact expandable rendering and safely persisted Wiki interactions.

## Requirements

### Requirement: Recursive YAML checklist items

The central component registry SHALL expose `checklist@1`. Its YAML payload SHALL be an object with an `items` list. Each item SHALL have a non-empty string `title`, optional string or null `content`, optional list or null `children` containing the same item shape, and optional `status` object with boolean `agent_completed`, `human_acknowledged`, and `human_reviewed` fields. Missing state fields SHALL mean false; absent or null content and children SHALL mean empty. Empty root lists SHALL be valid. Unknown fields, non-boolean states, malformed YAML, cyclic/aliased structures, and invalid item shapes SHALL produce `WIKI_COMPONENT_INVALID` and retain the ordinary fenced block rather than partially render misleading states.

#### Scenario: Minimal recursive item
- **WHEN** a checklist contains an item with only a title and a child with empty content and children
- **THEN** both items render with three unchecked states and no empty content toggle

#### Scenario: Independent states
- **WHEN** an item has human review true, human awareness false, and Agent completion false
- **THEN** exactly the specified human review state is checked, with no inferred state on that item or its relatives

#### Scenario: Invalid state remains readable
- **WHEN** a status value is the string `"false"` rather than a YAML boolean
- **THEN** the component is invalid and its original YAML remains visible as code

### Requirement: Compact numbered rendering

Every item SHALL show its title and bold hierarchical position (`1`, `1.1`, `1.2`, `2`) in YAML sequence order, plus three separately labeled state controls. Item content SHALL start collapsed and become visible only after an explicit accessible expansion action. Expanded content SHALL preserve line breaks. Empty content SHALL have no expansion control. Child rows SHALL stay visible independently of the parent's content toggle. Numbering SHALL be derived, never persisted. Shared Markdown surfaces SHALL render the same checklist; where no writable document context exists, status controls SHALL be disabled and explicitly described as read-only. Layout SHALL wrap rather than overflow narrow viewports.

#### Scenario: Expand one description
- **WHEN** the reader expands item `1` in a tree containing `1.1` and `2`
- **THEN** only item `1`'s description becomes visible, child rows remain visible, and no status changes or writes occur

#### Scenario: Empty description
- **WHEN** an item has no content
- **THEN** its title, bold number, children and state controls remain usable without an empty disclosure affordance

### Requirement: Explicit human authority and independent updates

Agents SHALL set `agent_completed` only after completing that item's work. Agents SHALL NOT set or clear `human_acknowledged` or `human_reviewed` unless the user explicitly authorizes that operation for the relevant items. Owner-driven UI actions SHALL update only the selected item's selected flag, including clearing it. Parent and child states SHALL NOT aggregate or cascade. Checklist human flags SHALL be separate from Wiki commit review and SHALL NOT create or remove Wiki review marks. The component manual SHALL make these rules explicit. Existing filesystem access cannot authenticate a human behind a direct YAML edit; authoring authority is a documented Agent boundary, not a claim of filesystem enforcement.

#### Scenario: Agent completes an item
- **WHEN** an Agent finishes an item's work without human-state authorization
- **THEN** it may set only that item's Agent completion and preserves both human flags

#### Scenario: User grants a specific human mark
- **WHEN** the user explicitly asks an Agent to mark one item as known
- **THEN** the Agent may update that item's awareness flag without changing review or other items

### Requirement: Wiki clicks persist with conflict safety

Authenticated owners SHALL be able to toggle checklist states on both full-page and side-pane Wiki reading surfaces through the existing page write operation with the displayed snapshot's mtime and hash. The write SHALL identify the specific source block and recursive item position, preserve unrelated document content, and update only the requested flag's value. Successful writes SHALL refresh the shared page/list caches and survive reload. Viewer controls SHALL be disabled. Storage read-only restrictions SHALL remain enforced; a rejected write SHALL show an actionable error and SHALL NOT falsely display success. Pending writes SHALL disable further status edits for that document view. A conflict SHALL not overwrite or retry against a fresh snapshot automatically; the reader SHALL be offered a reload before trying again.

#### Scenario: Repeated blocks target exactly one item
- **WHEN** a page contains two identical checklist blocks and the owner toggles a child in the second block
- **THEN** only the selected child flag in the second block changes and both blocks plus surrounding prose remain intact

#### Scenario: Concurrent document edit
- **WHEN** the on-disk document changes after the displayed snapshot and a user toggles a state
- **THEN** the existing optimistic lock rejects the write and the UI exposes the conflict without losing external edits

#### Scenario: Viewer or read-only project
- **WHEN** a viewer reads a checklist, or a project rejects writes as read-only
- **THEN** no persisted state is changed and the UI does not present an unsaved toggle as successful

### Requirement: Discoverable authoring and examples

The registry's component listing and manual SHALL document all fields, state ownership, rendering, copyable YAML, invalid examples and rendered fixtures. Neutral examples SHALL cover recursive items, empty content and children, and all-false state. The user-requested Wiki home SHALL receive a real registered checklist example after implementation, without asserting human awareness or review on the user's behalf.

#### Scenario: Author discovers syntax
- **WHEN** an author requests `memon wiki components show checklist@1` from the updated central service
- **THEN** the response includes the recursive YAML example, all three independent state fields, human authorization boundary, and rendered fixture references
