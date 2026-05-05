## ADDED Requirements

### Requirement: Warnings card on the experiment detail page

The experiment detail page SHALL render a `Warnings` card after the `Caveats` card and before the `Artifacts` card. The card SHALL list every warning row from the experiment's `## Warnings` section as an interactive table, one row per warning, with columns matching the on-disk schema: status badge, created timestamp (rendered in browser timezone), category badge, message, resolved timestamp, and note.

When the experiment has zero warnings (no `## Warnings` section, or the section parses but is empty), the card SHALL render an empty-state message "No warnings — add one if you noticed something the human should review" plus an "Add warning" affordance.

The card SHALL surface a per-experiment count badge (e.g. "3 open / 1 resolved") in the card header, mirroring the badge pattern used elsewhere.

#### Scenario: Card placement between Caveats and Artifacts
- **WHEN** the user opens the detail page of an experiment whose README has a populated Warnings section
- **THEN** the rendered DOM order is: Caveats card → Warnings card → Artifacts card

#### Scenario: Empty state rendered when no warnings
- **GIVEN** an experiment whose README has no `## Warnings` section
- **WHEN** the user opens the detail page
- **THEN** the Warnings card renders an empty-state message and an "Add warning" button; no table rows are rendered

#### Scenario: Header count badge reflects status split
- **GIVEN** an experiment with 3 OPEN and 1 RESOLVED warning rows
- **WHEN** the user opens the detail page
- **THEN** the Warnings card header shows a count badge with the text "3 open / 1 resolved" (or equivalent), and the open count uses a warning-styled badge while the resolved count uses a success-styled badge

### Requirement: Interactive warning row controls

The Warnings card SHALL provide per-row interactive controls:

- **Resolve**: a button on each `OPEN` row that opens an inline note input; submitting calls `PATCH /api/experiments/:id/warnings/:rowId` with `{op: "resolve", note}`.
- **Reopen**: a button on each `RESOLVED` row that calls `PATCH /api/experiments/:id/warnings/:rowId` with `{op: "reopen"}`. The note prompt is optional.
- **Edit Note**: an inline-edit affordance on the Note cell of `RESOLVED` rows. Edits persist via `PATCH` with `{op: "resolve", note: <new>}` (resolve is idempotent).
- **Delete**: a destructive control behind a confirm dialog (shadcn `<AlertDialog>`) calling `DELETE /api/experiments/:id/warnings/:rowId`.
- **Add warning**: a form at the bottom of the card with fields for category (shadcn `<Select>` populated with the closed enum) and message (shadcn `<Textarea>`); submit calls `POST /api/experiments/:id/warnings`.

All write paths SHALL flow through the existing conflict-aware save flow used by the README editor: requests carry the current `mtime` + content `hash`, and on `409` the client refetches and surfaces the conflict to the user. Per-row submits SHALL NOT block other rows; concurrent edits are serialised per row.

The form SHALL use shadcn primitives (`Select`, `Textarea`, `Button`, `Dialog`, `AlertDialog`) — never native form controls — per the project's Web app conventions.

#### Scenario: Resolve flow records the note
- **GIVEN** an OPEN warning row
- **WHEN** the user clicks Resolve, types a note, and submits
- **THEN** the row updates in place to `RESOLVED` with the note rendered, the request returned a new `mtime`, and the local card state reflects the new mtime for subsequent operations

#### Scenario: Add warning form validates category against enum
- **WHEN** the user opens the Add warning form
- **THEN** the category select's options are exactly the 8 enum values from the experiment-readme spec, the message field is required, and submitting without a message disables the submit button

#### Scenario: Delete shows AlertDialog confirm
- **WHEN** the user clicks Delete on any row
- **THEN** an AlertDialog opens describing what will be deleted, and the row is removed only after explicit confirmation

#### Scenario: Concurrent edit triggers conflict dialog
- **GIVEN** the user has the Warnings card open, mtime M0
- **WHEN** another process resolves a different row, bringing the file to mtime M1, and the user then clicks Resolve on yet another row
- **THEN** the request returns 409, the existing conflict-resolution dialog opens with the latest server state, and the user's pending edit is preserved as a draft to retry

### Requirement: Warning HTTP endpoints

The web backend SHALL expose REST endpoints under `/api/experiments/:id/warnings`:

- `GET /api/experiments/:id/warnings` returns `{warnings: Warning[], mtime, hash}` for the experiment.
- `POST /api/experiments/:id/warnings` body `{category, message, expectedMtime, expectedHash}` appends a new OPEN row; returns `{rowId, mtime, hash}`.
- `PATCH /api/experiments/:id/warnings/:rowId` body `{op: "resolve" | "reopen", note?, expectedMtime, expectedHash}` mutates the row.
- `DELETE /api/experiments/:id/warnings/:rowId` body `{expectedMtime, expectedHash}` removes the row.

All endpoints SHALL pass the experiment id through `assertWithinProjectRoots()` before touching the filesystem. All write endpoints SHALL invoke the section-bound writer defined in the `experiment-readme` capability and SHALL append a `[WARNING]` event to JOURNAL.md per write. On a section-bound writer CONFLICT, the endpoint SHALL respond `409` with the current file's content + mtime + hash so the client can rebase.

#### Scenario: GET returns parsed warnings with mtime
- **WHEN** a client GETs `/api/experiments/foo-260501/warnings`
- **THEN** the response is JSON with `warnings: Warning[]`, `mtime: <number>`, `hash: <sha1>`; the warnings array reflects the on-disk table; status 200

#### Scenario: POST appends and returns rowId
- **WHEN** a client POSTs a valid `{category, message, expectedMtime, expectedHash}`
- **THEN** the response is `{rowId, mtime, hash}` with status 200, the README's `## Warnings` section contains the new row, and a `[WARNING]` add event is appended to JOURNAL

#### Scenario: PATCH on missing rowId returns 404
- **WHEN** a client PATCHes `/api/experiments/foo-260501/warnings/w_does_not_exist`
- **THEN** the response is status 404 and the README is not modified

#### Scenario: Path safety on the id parameter
- **WHEN** a client requests `/api/experiments/..%2Fother-project%2Frun/warnings`
- **THEN** the request is rejected by `assertWithinProjectRoots()` before any filesystem access; the response is 400 or 403 (matching existing path-safety behaviour)

#### Scenario: 409 on stale expectedMtime
- **WHEN** a write request carries `expectedMtime` older than the on-disk mtime AND the warnings section was edited in between
- **THEN** the response is 409 with body `{warnings, mtime, hash}` reflecting the current state; the file is not modified
