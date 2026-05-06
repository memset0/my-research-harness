## ADDED Requirements

### Requirement: `POST /api/open-claude-code` resolves a target's working directory

The web layer SHALL expose `POST /api/open-claude-code` accepting a
JSON body `{ kind: 'exp' | 'run', id: string, projectName: string }`.
The endpoint resolves the working directory for a Claude Code launch
on the given target and returns a copy-paste command. It does NOT
spawn a process — `memon serve` is shared across users on a cluster,
so server-side spawn would launch in the wrong session.

The response shape SHALL be `{ command: string, cwd: string, hint:
string }`:
- `command` — a shell-quoted `cd <cwd> && claude` string. The user
  pastes this into a local terminal.
- `cwd` — the resolved absolute working directory. For `kind: 'exp'`,
  this is the project root (so the agent can see both
  `docs/experiments/` and `logs/`); for `kind: 'run'`, this is the
  run dir.
- `hint` — a one-sentence description naming the target (e.g.
  `"Edit docs/experiments/E0001-foo.md (experiment E0001-foo)"`),
  intended for a toast or console message.

The endpoint SHALL return:
- 400 BAD_REQUEST when the body fails the JSON schema
- 404 NOT_FOUND when the project is not configured, or the named
  experiment / run does not exist in the runtime index
- 200 OK with the response shape on success

The endpoint SHALL invoke `assertWithinProjectRoots()` on the
resolved cwd before returning, so a tampered runtime index can't
leak a path outside any configured project root.

#### Scenario: Resolve cwd for an experiment doc
- **WHEN** a client POSTs `{kind: 'exp', id: 'E0001-foo',
  projectName: 'project-a'}`
- **THEN** the response is 200 with `cwd` equal to the absolute
  path of `project-a`'s root, `command` starting with `cd ` and
  ending with `&& claude`, and `hint` mentioning the exp doc id

#### Scenario: Resolve cwd for a run
- **WHEN** a client POSTs `{kind: 'run', id: 'foo-260501-100000',
  projectName: 'project-a'}`
- **THEN** the response is 200 with `cwd` equal to the run dir's
  absolute path

#### Scenario: 404 on unknown id
- **WHEN** a client POSTs `{kind: 'exp', id: 'E9999-nope',
  projectName: 'project-a'}`
- **THEN** the response is 404 with `error.code: NOT_FOUND`

#### Scenario: 404 on unknown project
- **WHEN** a client POSTs with `projectName: 'no-such-project'`
- **THEN** the response is 404 with `error.code: NOT_FOUND`

### Requirement: `Open Claude Code` button consumes the resolve endpoint

Both the exp-level and run-panel `Open Claude Code` buttons SHALL
call `POST /api/open-claude-code` with the appropriate `kind` / `id`
/ `projectName` and copy `response.command` to the clipboard via
`navigator.clipboard.writeText`. A toast SHALL confirm the copy with
`response.hint` as its description.

If the clipboard write fails (browser policy / no
`navigator.clipboard`), the toast SHALL fall back to a `toast.message`
that displays the command inline so the user can copy it manually.

#### Scenario: Click copies the command
- **WHEN** the user clicks the exp-level `Open Claude Code` button
  on `/p/project-a/e/E0001-foo`
- **THEN** the client POSTs `/api/open-claude-code` with
  `{kind: 'exp', id: 'E0001-foo', projectName: 'project-a'}`,
  receives a `command` string, writes it to the clipboard, and
  shows a `toast.success` whose description is the response `hint`

#### Scenario: Clipboard-blocked fallback
- **GIVEN** `navigator.clipboard.writeText` rejects (e.g. sandbox
  policy)
- **WHEN** the user clicks `Open Claude Code`
- **THEN** the UI surfaces a `toast.message` with the command in
  its description so the user can copy it manually
