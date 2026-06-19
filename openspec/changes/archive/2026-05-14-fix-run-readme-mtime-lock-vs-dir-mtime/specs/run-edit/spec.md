## MODIFIED Requirements

### Requirement: Run README write with optimistic mtime + content hash

The system SHALL accept run README writes via `PUT /api/runs/:id/readme`
carrying `expectedMtime` (and optional `expectedHash`). The backend SHALL
compare both against the disk's current state before writing.

**The `expectedMtime` value SHALL be the README.md file's mtime in
isolation — NOT the synthesized run-effective mtime from `run-discovery`
(which is `max(dir, README)`).** The web client SHALL pass
`run.readmeMtime` from the run record; the CLI SHALL pass the value
returned by stat'ing the README.md file directly. The server SHALL
compare `expectedMtime` against `fs.stat(<runDir>/README.md).mtimeMs`
ONLY; the run dir's own mtime SHALL be irrelevant to the lock decision.

#### Scenario: Successful write
- **WHEN** `expectedMtime` and `expectedHash` match the on-disk values
- **THEN** the backend writes the new content, returns 200 with the new
  `mtime` + `hash`, and appends an event to JOURNAL.md

#### Scenario: Conflict on mtime
- **WHEN** the on-disk README's `mtime` differs from `expectedMtime`
  AND the canonical re-serialization of the request `content` differs
  from the canonical re-serialization of the on-disk content
- **THEN** the backend returns 409 with the current on-disk content,
  `mtime`, and `hash` so the client can rebase

#### Scenario: Conflict on hash with matching mtime
- **WHEN** `expectedMtime` matches but `expectedHash` does not
- **THEN** the backend returns 409 (defends against low-resolution mtime
  on NFS)

#### Scenario: Stale mtime with identical content is idempotent
- **GIVEN** an on-disk README at mtime `M1` whose canonical re-serialization
  hash is `H1`
- **WHEN** the client POSTs new content whose canonical re-serialization
  hash also equals `H1`, with `expectedMtime: M0` (where `M0 < M1` —
  client view is stale)
- **THEN** the backend returns 200 with `{ ok: true, mtime: M1, hash: H1,
  finalContent: <on-disk-content> }`
- **AND** the file is NOT rewritten (no mtime bump)
- **AND** NO `[STATUS]` / `[ARCHIVE]` JOURNAL event is appended
- **AND** the client uses the response as its new editor baseline

#### Scenario: Run-dir activity does not invalidate the README lock
- **GIVEN** a run README written at `M_readme` and the run dir touched
  by an artifact write at `M_dir` with `M_dir > M_readme`, both
  observed by discovery so `run.mtime === M_dir`, `run.readmeMtime ===
  M_readme`
- **WHEN** the client POSTs a README write with `expectedMtime: M_readme`
- **THEN** the backend stats `<runDir>/README.md`, sees `M_readme`, and
  proceeds with the write (succeeds 200)
- **AND** the run dir's mtime is irrelevant to the decision

## ADDED Requirements

### Requirement: Run archive route is idempotent on stale mtime when target matches on-disk state

`PATCH /api/runs/:id/archive` SHALL gracefully handle the case where the
client's `expectedMtime` is stale relative to the on-disk README.md but
the on-disk frontmatter already has `archived: <requested-target>`.

Concretely, when:
1. `expectedMtime` is provided AND `expectedMtime !== stat.mtimeMs`, AND
2. the on-disk parsed `frontMatter.archived` equals the request body's
   `archived` field,

the backend SHALL return 200 with `{ ok: true, archived: <target>,
mtime: <current on-disk mtime>, noop: true }`. The file SHALL NOT be
rewritten and no `[ARCHIVE]` JOURNAL event SHALL be appended.

When the on-disk archived state DIFFERS from the requested target AND
the mtime is stale, the backend SHALL continue to return 409 with the
current on-disk content, mtime, and hash (the existing conflict
behavior).

#### Scenario: Archive request races with a poll that bumped run.mtime
- **GIVEN** a run with on-disk `archived: false`, README mtime `M_readme`,
  and `run.mtime === M_dir > M_readme` (the synthesized dir-effective mtime)
- **WHEN** a misbehaving client posts `PATCH /api/runs/:id/archive` with
  `{ archived: true, expectedMtime: M_dir }` (the WRONG key)
- **AND** the on-disk README still has `archived: false`
- **THEN** the response is 409 with the current README content
  (since the target `archived: true` does NOT match the on-disk `false`)

#### Scenario: Double-archive resolves to noop on stale mtime
- **GIVEN** two clients both view a run with `archived: false`
- **WHEN** client A archives it (`archived: true`), bumping the on-disk
  mtime, AND immediately after, client B sends
  `PATCH .../archive { archived: true, expectedMtime: <pre-archive mtime> }`
- **THEN** client B receives 200 with `{ ok: true, archived: true,
  mtime: <post-A mtime>, noop: true }`
- **AND** the README is not rewritten by client B's call
- **AND** at most one `[ARCHIVE] op=archive` event exists in JOURNAL

### Requirement: Run status route is idempotent on stale mtime when target matches on-disk state

`PATCH /api/runs/:id/status` SHALL gracefully handle the case where the
client's `expectedMtime` is stale but the on-disk frontmatter's `status`
already equals the requested `status`.

Concretely, when:
1. `expectedMtime !== stat.mtimeMs`, AND
2. the on-disk parsed `frontMatter.status` equals the request body's
   `status` field,

the backend SHALL return 200 with `{ ok: true, status: <target>,
mtime: <current on-disk mtime>, noop: true }`. The file SHALL NOT be
rewritten and no `[STATUS]` JOURNAL event SHALL be appended.

When the on-disk status DIFFERS from the requested target AND the mtime
is stale, the backend SHALL continue to return 409.

#### Scenario: Status transition on stale mtime is idempotent when target already set
- **GIVEN** a run with on-disk `status: FINISHED` and a client view that
  predates the most recent README rewrite (`expectedMtime: M0 < M_readme`)
- **WHEN** the client posts `PATCH .../status { status: 'FINISHED',
  expectedMtime: M0 }`
- **THEN** the response is 200 with `{ ok: true, status: 'FINISHED',
  mtime: M_readme, noop: true }`
- **AND** no `[STATUS]` event is appended to JOURNAL
