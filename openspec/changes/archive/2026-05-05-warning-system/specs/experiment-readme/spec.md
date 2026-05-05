## MODIFIED Requirements

### Requirement: Standard markdown sections

The `README.md` body SHALL contain the following H2 sections in this order: `Motivation`, `Setup`, `Method`, `Result`, `Conclusion`, `Caveats`, `Artifacts`. An optional `New Hypotheses` section MAY appear after `Artifacts`. An optional `Warnings` section MAY appear between `Caveats` and `Artifacts`.

The parser SHALL tolerate additional non-canonical H2 sections appearing anywhere in the body (e.g., user-added free-form headings) without erroring; such sections SHALL be preserved verbatim by any writer that does not target them.

#### Scenario: Section missing or empty
- **WHEN** a section header is missing from `README.md`
- **THEN** the parser records the absence on the experiment record but does not error; the frontend renders the section as a placeholder labeled "to fill"

#### Scenario: Artifacts section format
- **WHEN** the `Artifacts` section contains entries of the form `- \`./path/\` — description`
- **THEN** the parser extracts a list of `{path, description}` pairs that are surfaced to the frontend artifacts view

#### Scenario: Warnings section is OPTIONAL
- **WHEN** a `README.md` omits the `## Warnings` heading entirely
- **THEN** the parser does NOT surface a missing-section warning, the experiment record's `warnings` field is the empty array `[]`, and the README remains valid

#### Scenario: Non-canonical H2 sections are preserved
- **GIVEN** a `README.md` that contains a user-added `## Discussion` section after `## Conclusion`
- **WHEN** the parser indexes the experiment, AND any subsequent section-bound write (e.g., a warning append) is applied
- **THEN** the `## Discussion` section's contents are unchanged byte-for-byte after the write, and the parser does not error on its presence

## ADDED Requirements

### Requirement: Warnings section table format

When present, the `## Warnings` H2 section body SHALL contain exactly one GFM table with the column header row `| Status | Created | Category | Message | Resolved | Note |` (in that order; column header text is case-insensitive but the order is fixed). Each subsequent row SHALL represent one warning. The table MAY be preceded by a single optional descriptive paragraph but SHALL NOT contain other prose between rows. Rows SHALL terminate each line; pipes (`|`) inside cell content SHALL be backslash-escaped (`\|`); literal newlines inside cell content SHALL be encoded as `<br>`.

Each row SHALL carry a stable opaque row identifier (`rowId`) embedded as an HTML comment at the end of the row line, of the form `<!-- id:w_<isoCreatedColonsToHyphens>_<4hex> -->`. Writers SHALL emit the comment; readers SHALL treat the comment as authoritative and SHALL NOT use array index as identity.

Each warning row SHALL have:
- `Status` ∈ {`OPEN`, `RESOLVED`} (uppercase canonical form)
- `Created` (ISO8601 with timezone offset, set at append time, never edited thereafter)
- `Category` (one of the closed enum below; out-of-enum values surface a parse warning but the row is preserved)
- `Message` (free-text, escaped)
- `Resolved` (ISO8601 with offset when `Status === RESOLVED`; empty / `—` otherwise)
- `Note` (free-text, escaped; populated when status transitions to RESOLVED, optional otherwise)

The `Category` enum is: `methodology`, `result`, `config`, `data`, `repro`, `compare`, `infra`, `other`.

#### Scenario: Valid warnings table parses to typed array
- **GIVEN** a `## Warnings` section containing a header row plus two rows: one with `Status: OPEN, Category: result` and one with `Status: RESOLVED, Category: config, Resolved: 2026-05-04T11:00+08:00, Note: "intentional, A100 OOM at 512"`
- **WHEN** the parser indexes the experiment
- **THEN** `experiment.warnings` is an array of two `Warning` objects with the exact field values, both carrying their `rowId` from the trailing HTML comment

#### Scenario: Pipe escape in cell content round-trips
- **GIVEN** a warning whose Message is `loss = a|b at step 1500`
- **WHEN** the writer emits the row and the parser reads it back
- **THEN** the on-disk row contains `loss = a\|b at step 1500` and the parsed `Message` field equals exactly `loss = a|b at step 1500`

#### Scenario: Out-of-enum category preserved with parse warning
- **WHEN** a row has `Category: aesthetic` (not in the enum)
- **THEN** the parser surfaces an `UNKNOWN_WARNING_CATEGORY` warning naming the value, AND the row is still included in `experiment.warnings` with `category: "aesthetic"` (the parser does not silently drop user data)

#### Scenario: Status normalised to uppercase
- **WHEN** a row has `Status: open` (lowercase)
- **THEN** the parser produces a parse warning AND normalises the in-memory value to `OPEN`

#### Scenario: Non-conforming Warnings section is preserved as raw
- **GIVEN** a `## Warnings` section that contains prose / a list / no table
- **WHEN** the parser indexes the experiment
- **THEN** `experiment.warnings` is `[]`, `experiment.warningsRaw` contains the section bytes, and the parser surfaces a `WARNINGS_SECTION_NOT_TABLE` warning. Section-bound writers SHALL refuse to mutate this section and SHALL surface a diagnostic to the user.

### Requirement: Section-bound writes for the Warnings section

The system SHALL provide a section-bound write path for the `## Warnings` section that mutates only lines inside that section's H2 range. The writer SHALL:

1. Locate the section by an anchored heading match (`^## Warnings\s*$`) and capture the line range from the heading to the line before the next H2 (or EOF).
2. If the section is absent, insert it at the canonical position: after `## Caveats` and before `## Artifacts`. If `## Caveats` is missing, insert before `## Artifacts`. If both anchors are missing, append at EOF (immediately before `## New Hypotheses` if that section exists).
3. Apply the row mutation only inside the captured (or newly created) range.
4. Before flushing to disk, diff the proposed file against the on-disk file and assert that no line outside the captured range differs. If the assertion fails, abort the write and surface an internal error.
5. Use `expectedMtime` + `expectedHash` against the whole file for optimistic locking. On a concurrent edit that did NOT touch the Warnings section's pre-image, the writer MAY rebase its row mutation onto the latest content and retry once. If the Warnings section's pre-image changed, the writer SHALL surface a CONFLICT to the caller.

#### Scenario: Append warning preserves a parallel Method edit
- **GIVEN** a README at mtime M0; a section-bound writer is preparing to append a warning row; meanwhile another process replaces the `## Method` section's body and the file is now at mtime M1 (Warnings section bytes unchanged)
- **WHEN** the section-bound writer commits its append
- **THEN** the resulting file contains BOTH the new warning row AND the new Method section body; the writer's pre-flush diff assertion passes; the response carries the new mtime

#### Scenario: Concurrent edit to Warnings section forces CONFLICT
- **GIVEN** a section-bound writer is preparing to append a warning row at mtime M0; before it commits, another process adds a different warning row at mtime M1
- **WHEN** the writer attempts to commit
- **THEN** the operation exits with code 9 `CONFLICT` (CLI) or HTTP 409 (API), the file is not modified, and the response includes the current mtime + content for retry

#### Scenario: Diff assertion catches accidental clobber
- **GIVEN** a buggy implementation that accidentally rewrites a line in `## Method` while appending a warning row
- **WHEN** the writer performs its pre-flush diff assertion
- **THEN** the write aborts before flushing to disk, an internal error is surfaced, and the file on disk is unchanged

#### Scenario: Section creation when missing
- **GIVEN** a README that has `## Caveats` and `## Artifacts` but no `## Warnings`
- **WHEN** the writer appends the first warning
- **THEN** the resulting file contains a new `## Warnings` H2 between the two anchors, the table header row, and the new warning row; the rest of the file is byte-identical aside from the inserted block

### Requirement: Warning row identity and audit trail

Every warning operation (`add`, `resolve`, `reopen`, `delete`) SHALL append a single `[WARNING]` event to `JOURNAL.md` carrying `{op, rowId, category, message?}` so that warning history is reconstructible even if a row is later deleted from the README.

#### Scenario: Add appends WARNING add event
- **WHEN** `memon experiment warning add` succeeds
- **THEN** `JOURNAL.md` has one new event line tagged `[WARNING]` with body containing `op=add`, the new `rowId`, the `category`, and the `message`

#### Scenario: Delete appends WARNING delete event preserving content
- **WHEN** `memon experiment warning delete` succeeds
- **THEN** the journal event line includes the deleted row's full content (status, category, message, resolved, note) so the row can be reconstructed if needed

#### Scenario: Reopen clears Resolved and Note
- **GIVEN** a row with status `RESOLVED`, `Resolved: 2026-05-04T11:00+08:00`, `Note: "intentional"`
- **WHEN** `memon experiment warning reopen <id> <rowId>` is called
- **THEN** the row's status flips to `OPEN`, the `Resolved` and `Note` cells are emptied (rendered as `—` or blank), `Created` is preserved, and a `[WARNING]` reopen event is appended to JOURNAL
