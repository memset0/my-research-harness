# experiment-edit Specification

## Purpose
TBD - created by archiving change add-write-flow. Update Purpose after archive.
## Requirements
### Requirement: Status edit control on the detail page

The experiment detail page SHALL provide a control (dropdown or button group) listing all 5 status enum values. Selecting a different value SHALL invoke the same atomic write protocol defined for `PUT /api/readme` and `[STATUS]` event append.

#### Scenario: Successful status change
- **WHEN** the user selects `FAILED` for an experiment whose current `status` is `RUNNING`, with a fresh `expectedMtime`
- **THEN** the page issues `PUT /api/readme` with the updated front matter, the backend writes the README and appends `[STATUS] \`<id>\` RUNNING → FAILED` to JOURNAL.md atomically, the page re-fetches the experiment, and a success toast `Saved · status FAILED` is shown for ~1s

#### Scenario: Status change race
- **WHEN** the on-disk README has changed between the page load and the status submit
- **THEN** the backend returns 409 with current content and the conflict modal opens (see "Conflict resolution dialog")

### Requirement: README inline editor

The detail page SHALL provide an `Edit README` action that opens a modal containing a `@uiw/react-md-editor` instance prefilled with the current README content (front matter + body). The editor SHALL support source/preview split-pane and code-block highlighting.

#### Scenario: Open and save
- **WHEN** the user clicks `Edit README`, makes changes, and clicks `Save`
- **THEN** the page issues `PUT /api/readme` with `{path, content, expectedMtime, expectedHash}`; on 200 the modal closes, the rendered detail view updates from the new content, and a success toast appears

#### Scenario: Lazy-loaded editor
- **WHEN** the user is on a list/detail page but has not opened any editor yet
- **THEN** the editor module is NOT in the initial JS bundle (it is dynamically imported only when an editor modal opens)

### Requirement: Conflict resolution dialog

When `PUT /api/readme` returns 409, the editor modal SHALL transition into a conflict view rendering the user's draft on the left and the server's current content on the right, using `react-diff-viewer-continued`. The user SHALL have three options: `Keep my changes (overwrite)`, `Discard mine (use disk)`, `Cancel`.

#### Scenario: Keep my changes
- **WHEN** the user clicks `Keep my changes`
- **THEN** the page re-issues `PUT /api/readme` carrying the **current on-disk mtime** (received in the 409 body) and the user's draft content; on success, the modal closes

#### Scenario: Discard mine
- **WHEN** the user clicks `Discard mine`
- **THEN** the editor's content is replaced with the server's current content, the conflict view is dismissed, and the editor returns to the normal edit mode (so the user can keep editing on top of the latest disk state)

#### Scenario: Cancel
- **WHEN** the user clicks `Cancel`
- **THEN** the conflict view is dismissed but the editor remains open with the user's draft intact (no save attempted, no toast)

### Requirement: localStorage draft autosave

While the editor modal is open, the editor content SHALL be persisted to `localStorage` with key pattern `memon:draft:<absolute file path>:<mtime opened>`. Persistence SHALL debounce keystrokes by ~500ms.

#### Scenario: Continuous edits persist
- **WHEN** the user types in the editor for 5 seconds, then closes the browser tab without saving
- **THEN** the latest content (typed > 500ms before tab close) is in localStorage under the matching key

#### Scenario: Storage quota errors
- **WHEN** the localStorage write throws `QuotaExceededError`
- **THEN** the page shows a `toast.error('Draft autosave failed (storage full)')` and continues to function (in-memory state still intact)

### Requirement: Draft recovery prompt on editor open

When the user opens the editor for a path that already has a localStorage draft, the editor SHALL check the on-disk mtime against the draft's key:
- If they match (no external write occurred): SHOW a prompt `You have an unsaved draft from N minutes ago — Restore / Discard from disk`
- If the on-disk mtime is newer (external write occurred): silently discard the draft and inform via inline banner `Disk content has changed since your last edit`

#### Scenario: Restore draft
- **WHEN** the user clicks `Restore`
- **THEN** the editor opens with the draft content, and `expectedMtime` is set to the draft's key mtime (so save attempts will trigger the conflict view if disk has since changed)

#### Scenario: Discard from disk
- **WHEN** the user clicks `Discard from disk`
- **THEN** the editor opens with the current on-disk content, and the matching localStorage key is deleted

#### Scenario: Skip recovery for tiny drafts
- **WHEN** a draft exists but its content differs from disk by fewer than 5 characters (essentially noise)
- **THEN** the recovery prompt is NOT shown and the draft is silently deleted

### Requirement: 7-day stale draft cleanup

On editor open, the page SHALL scan all `memon:draft:*` keys and delete entries whose `savedAt` is older than 7 days.

#### Scenario: Old draft cleaned
- **WHEN** the user opens any editor and `localStorage` contains a draft with `savedAt = 8 days ago`
- **THEN** that key is deleted before the recovery prompt logic runs

### Requirement: Add NOTE event from detail page

The detail page SHALL provide a `+ Note` button that opens a small modal with a textarea and a `Submit` button. Submission SHALL `POST /api/journal/append` with `{ project, tag: 'NOTE', body: \`\\\`<id>\\\` <user input>\` }`.

#### Scenario: Append note
- **WHEN** the user types `converged faster than expected` in the modal and clicks `Submit`
- **THEN** the JOURNAL.md gains a new `[NOTE]` event line with the experiment's id backticked and the user's text appended, and a success toast appears

#### Scenario: Cancel note
- **WHEN** the user closes the modal without submitting
- **THEN** no network request is made and no event is appended

### Requirement: Add NOTE / REQUEST from journal page

The journal page SHALL provide a `+ Add` control that opens a modal letting the user pick a tag (`NOTE` or `REQUEST`) and enter free-form body. Submission SHALL `POST /api/journal/append` with the chosen tag.

#### Scenario: Append request
- **WHEN** the user picks `REQUEST` and types `please summarize experiments related to H7`, then submits
- **THEN** a new `[REQUEST]` event is appended to JOURNAL.md and the timeline view reflects it (after the next SSE event or query refetch)

### Requirement: Create experiment from web UI

The list page SHALL provide a `+ New experiment` button that opens a modal with `name` (required) and `project` (defaulting to current; selectable when multiple projects are configured) inputs. Submission SHALL `POST /api/experiments` with `{ name, project }`. The backend SHALL run the same scaffolding logic as `memon new` (create directory, write README + run.sh templates, append `[CREATE]` event), then return `{ id, path, project }`.

#### Scenario: Create and navigate
- **WHEN** the user enters `attn-overlap` for project `project-a` and clicks `Create`
- **THEN** a new directory `<project-a-root>/logs/attn-overlap-<yymmdd>-<hhmmss>/` is created with README.md + run.sh, a `[CREATE]` event is appended to JOURNAL.md, and the user is navigated to the new experiment's detail page

#### Scenario: Name collision in same second
- **WHEN** the same name is submitted within a one-second window producing a directory that already exists
- **THEN** the backend returns 409 and the modal shows an inline error `An experiment with that name already exists this second; try again`

### Requirement: POST /api/experiments backend route

The backend SHALL expose `POST /api/experiments` accepting `{ name: string, project?: string }`. Implementation SHALL share core scaffolding logic with the CLI's `memon new` command (extracted to `@memon/core`).

#### Scenario: Successful creation
- **WHEN** a valid request is received
- **THEN** the response is 200 with `{ created: { id, path, project } }` and the runtime ExperimentIndex is updated immediately (so the next `/api/experiments` GET reflects the new row)

#### Scenario: Unknown project
- **WHEN** the body specifies a `project` that is not in the resolved config
- **THEN** the response is 404 with `{ error: { code: 'NOT_FOUND', message: 'project "..." not configured' } }`

#### Scenario: Default project resolution
- **WHEN** the body omits `project`
- **THEN** the backend defaults to the first project in the resolved config

