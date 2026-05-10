## ADDED Requirements

### Requirement: `## Plan` section edits go through the existing markdown write path

Edits to an experiment doc's `## Plan` section SHALL be performed via
the existing `PUT /api/experiments/:id/readme` endpoint (the same path
used for editing any other experiment doc body section). No new API
endpoint is introduced for Plan in v1.

The frontend save handshake for Plan edits SHALL be identical to the
handshake already specified for experiment doc writes
(`expectedMtime` + `expectedHash`, `updated_at` rewritten in the
editor buffer to `now()`-with-offset, `finalContent` re-baselined on
200, conflict UI on 409).

The `PUT /api/experiments/:id/readme` endpoint SHALL preserve the
`## Plan` section body verbatim through the parse → mutate → serialize
cycle: a write that does not target Plan SHALL NOT alter Plan's body
(byte-for-byte, modulo trailing whitespace normalization the
serializer already performs on every section).

After a successful Plan edit, the backend SHALL fire the existing
`experiment-change` SSE topic (no new topic is introduced for Plan).
The TanStack query keys `['experiment', id]` and
`['experiments', project]` SHALL be invalidated by the existing
listener wiring.

#### Scenario: Plan edit via Edit markdown dialog persists
- **GIVEN** an experiment doc with `## Plan` body containing
  `- [ ] Try LR=3e-4` open in the Edit markdown dialog
- **WHEN** the user changes that line to `- [x] Try LR=3e-4` and
  clicks Save
- **THEN** the POST body's serialized markdown contains the updated
  `[x]` marker; the response is 200; the returned `finalContent`
  contains the new marker; the `experiment-change` SSE topic fires
  for that experiment

#### Scenario: Non-Plan edit preserves Plan body byte-exact
- **GIVEN** an experiment doc with a non-empty `## Plan` body
  containing nested checkboxes
- **WHEN** the user opens the Edit markdown dialog, modifies only the
  `## Method` body, and saves
- **THEN** the on-disk file's `## Plan` body after the write equals
  its body before the write (modulo trailing-whitespace normalization)

#### Scenario: Plan edit on a doc with no prior Plan section
- **GIVEN** a legacy experiment doc with no `## Plan` heading
- **WHEN** the user opens the Edit markdown dialog (which renders
  the empty-Plan placeholder), adds a `- [ ] First task` line under
  a freshly-typed `## Plan` heading, and saves
- **THEN** the response is 200; the on-disk file now contains a
  `## Plan` H2 in the canonical position (after Method, before
  Conclusion) with the new task line

#### Scenario: Concurrent Plan edit conflict surfaces 409
- **GIVEN** two browser tabs open the same experiment doc and both
  observe `expectedMtime: M0`
- **WHEN** tab A saves a Plan edit and the disk mtime advances to M1,
  then tab B saves its own Plan edit with `expectedMtime: M0`
- **THEN** tab B receives 409 with the current on-disk content,
  `mtime: M1`, and `hash`; tab B's editor buffer is restored and the
  conflict UI shows
