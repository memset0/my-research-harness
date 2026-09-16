## MODIFIED Requirements

### Requirement: Wiki clicks persist with conflict safety

Authenticated owners SHALL be able to toggle checklist states on both full-page and side-pane Wiki reading surfaces through the existing page write operation with the displayed snapshot's mtime and hash. Only static blocks (`yaml`/`json` payload without `script`/`code`) SHALL be toggleable; an executable checklist SHALL render its controls disabled with a notice that its state comes from the cached function result. The write SHALL identify the specific source block by its `#<id>` when present (otherwise by position) and the recursive item position, preserve unrelated document content, and update only the requested flag's value. Successful writes SHALL refresh the shared page/list caches and survive reload. Viewer controls SHALL be disabled. Storage read-only restrictions SHALL remain enforced; a rejected write SHALL show an actionable error and SHALL NOT falsely display success. Pending writes SHALL disable further status edits for that document view. A conflict SHALL not overwrite or retry against a fresh snapshot automatically; the reader SHALL be offered a reload before trying again.

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

The `memon-components` skill table SHALL document the checklist's fields, state ownership, rendering, a copyable YAML block in the `` ```yaml checklist@1 #<id> `` form, and rendered fixtures. Neutral examples SHALL cover recursive items, empty content and children, and all-false state. The user-requested Wiki home SHALL keep a real checklist example in the new declaration form, without asserting human awareness or review on the user's behalf.

#### Scenario: Author discovers syntax
- **WHEN** an author reads the `checklist` row of the generated skill table
- **THEN** it shows the recursive YAML example, all three independent state fields, the human authorization boundary, and the fixture reference
