## ADDED Requirements

### Requirement: File Agent read-edit grants allow only small document replacements

The File Agent SHALL accept `read`, `read-write` and `read-edit` as grant values. A `read-edit` principal SHALL read as a `read` principal. Its mutations SHALL be refused with `FORBIDDEN` unless the operation is `replace` of an existing regular file with a `match` precondition, without a mode, destination or file checks, at a project-relative path under `docs/reports/` or `docs/wiki/` whose last segment is `manifest.json` or ends in `.md`, or at exactly `.memon/index/reports.json` or `.memon/index/wiki.json`. After the precondition passes, the agent SHALL compare the current and the new bytes and refuse with `FORBIDDEN` when the bytes outside their common prefix and common suffix exceed 4096 on either side. Project `readOnly`, writer-lock acknowledgement, replay and the writer lock SHALL apply as for any mutation. The agent SHALL advertise `scoped-edits-v1`.

#### Scenario: Title-sized edit is applied
- **WHEN** a `read-edit` principal replaces `docs/reports/R0001-a/manifest.json` with bytes that differ from the current file only in the title
- **THEN** the agent applies the replacement

#### Scenario: Out-of-scope edits are refused
- **WHEN** a `read-edit` principal deletes a file, creates a file, writes `src/main.py`, or replaces a Report with bytes that differ over more than 4096 bytes
- **THEN** the agent refuses with `FORBIDDEN` and the file is unchanged

### Requirement: Central permits title edits on read-only Projects only when allowed

A central Project entry SHALL accept `allowed_edits`, a list whose only value is `title`. For a `read_only: true` Project, the title edit SHALL run with writes enabled only when `allowed_edits` contains `title`; any other write SHALL still be refused as read-only. A Project that is not read-only SHALL permit the title edit without the key.

#### Scenario: Read-only Project without the allowance
- **WHEN** the owner renames a Report on a `read_only: true` Project without `allowed_edits`
- **THEN** the request fails with 403 and no file is written

### Requirement: Title edits rewrite only the title

Renaming SHALL accept a title of 1 to 512 characters after trimming, without line breaks, and SHALL change only the title bytes: the top-level `title` string of `manifest.json`; the top-level `title` value in Markdown frontmatter, added as the last frontmatter key when absent; or, for a Markdown Report without frontmatter, the text of its first H1 outside code fences, with a frontmatter block holding the title prepended when it has no H1. The slug, ID, path, other metadata, `updated_at` and body SHALL be unchanged. The write SHALL use the bytes it read as its precondition. When the Project has a published catalog for the kind, central SHALL set the entry's `title` and `mtime` to the new values in `.memon/index/reports.json` or `wiki.json`, keeping all other bytes; the derived snapshot SHALL be left for `memon refresh`. A title edit SHALL record no journal receipt.

#### Scenario: Manifest title
- **WHEN** the owner renames HTML Report `R0002` to `New name`
- **THEN** only the `title` string in its `manifest.json` changes, and the Report list and sidebar show `New name`

#### Scenario: Wiki frontmatter title
- **WHEN** the owner renames Markdown Wiki page `W0001`
- **THEN** only the `title` frontmatter value of its README changes and the body is byte-identical

### Requirement: Owner renames a Report or Wiki page from its header

`POST /api/reports/<id>/title` and `POST /api/wiki/<id>/title` SHALL accept `{ "title": string }` from the owner only and return the updated document; an invalid title SHALL return 400, a refused edit 403, and a concurrent change 409. The expanded Report and Wiki page header SHALL offer Rename to the owner, opening a dialog with the current title; saving SHALL refresh the page and the lists.

#### Scenario: Rename from the header
- **WHEN** the owner expands a Report header, chooses Rename, enters a new title and saves
- **THEN** the header, the Report list and the sidebar show the new title
