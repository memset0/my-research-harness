## ADDED Requirements

### Requirement: Server-side pane-info enrichment with bounded shell-out cost

The web backend SHALL maintain a server-side helper that enriches every
row returned by `listMemonTmuxSessions` with a `pane` field carrying the
active pane's `title`, `currentCommand`, and `currentPath`. The data
SHALL be sourced from one `tmux list-panes -a -F …` shell-out per
refresh, filtered to rows where `window_active = 1 AND pane_active = 1`.

The format string SHALL be (in this exact order, with `pane_title` last
so embedded `|` characters in the title don't break the parser):

```
#{session_name}|#{window_active}|#{pane_active}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}|#{pane_title}
```

The parser SHALL split each line on `|` and rejoin all tokens past
position 6 with `|` to reconstruct titles containing the delimiter.

A short-lived in-process cache SHALL deduplicate concurrent shell-outs
within the same refresh window. The cache TTL SHALL be 800 milliseconds.
The cache slot SHALL be pinned on `globalThis` (matching the existing
`__memonTerminalState` pattern in `manager.ts`) so Next.js HMR reloads
do not drop in-flight pane data.

When tmux is unavailable, the shell-out fails, the format result is
empty, or no pane row matches a sessionName, the enrichment helper
SHALL fall back to `pane: null` for the affected row(s) and SHALL NOT
throw. `listMemonTmuxSessions` continues to return the original row
list with pane info set to `null` where missing.

The server SHALL truncate `pane.title` to 256 characters (with a `…`
suffix when truncated) before serialization. The server SHALL replace
embedded newline / carriage-return characters in `pane.title` with a
single space, defensively, even though tmux normally strips control
characters from titles.

#### Scenario: Single shell-out enriches every row
- **GIVEN** the host has three `memon-*` sessions, each with one active pane
- **WHEN** `listMemonTmuxSessions(rt)` runs
- **THEN** exactly one `tmux list-panes -a -F …` shell-out is invoked (in addition to the existing `tmux ls`)
- **AND** each returned row carries a `pane: { title, currentCommand, currentPath }` matching that session's active-window active-pane data

#### Scenario: Cache deduplicates concurrent enrichments
- **GIVEN** the host has at least one `memon-*` session and the pane cache is empty
- **WHEN** two `listMemonTmuxSessions(rt)` calls fire within the same 100 ms window
- **THEN** exactly one `tmux list-panes -a -F …` shell-out happens; the second call reads from cache
- **AND** both calls receive the same `pane` payload for matching rows

#### Scenario: Cache expires after 800 ms
- **GIVEN** the pane cache was populated at time T
- **WHEN** a new enrichment call arrives at time T + 900 ms
- **THEN** a fresh `tmux list-panes -a -F …` shell-out is invoked and the cache slot is overwritten

#### Scenario: tmux daemon down returns null pane info, not error
- **WHEN** `tmux list-panes -a` exits non-zero (daemon not running, or no panes on host)
- **THEN** `listMemonTmuxSessions` continues to return the existing row list
- **AND** every row's `pane` field is `null`
- **AND** no exception is propagated

#### Scenario: Title containing pipe character is preserved verbatim
- **GIVEN** an active pane whose `pane_title` is the literal string `a|b|c`
- **WHEN** the enrichment helper parses the `list-panes` output
- **THEN** the row's `pane.title` is exactly `a|b|c`

#### Scenario: Title exceeding 256 chars is truncated with ellipsis
- **GIVEN** a pane whose `pane_title` is 300 ASCII characters long
- **WHEN** enrichment returns
- **THEN** `pane.title.length === 257` (256 source chars truncated to 256 + a single `…` suffix)
- **AND** the last character of `pane.title` is `…`

#### Scenario: Newlines in title are replaced with spaces
- **GIVEN** a pane whose `pane_title` contains an embedded `\n`
- **WHEN** enrichment returns
- **THEN** the `\n` in `pane.title` has been replaced with a single space character

#### Scenario: Only the active window's active pane is included
- **GIVEN** a tmux session `memon-claude-project-a--run--foo-...` has two windows; window 0 is inactive with one pane, window 1 is active with two panes (pane 1 active)
- **WHEN** the enrichment helper parses `list-panes -a`
- **THEN** only the data for window 1 / pane 1 is associated with the session
- **AND** the row's `pane.currentCommand` reflects window 1's active pane

### Requirement: TmuxSessionRow carries pane info on the wire

The shape of each row returned by `GET /api/tmux-sessions` SHALL be
extended with the optional field:

```ts
pane: {
  /** PTY-protocol window title set by the foreground program. Truncated to ≤256+1 chars. */
  title: string | null
  /** Basename of the foreground process (e.g. `claude`, `bash`, `node`). */
  currentCommand: string | null
  /** Absolute cwd of the foreground process. */
  currentPath: string | null
} | null
```

A row's `pane` field SHALL be `null` when:
- tmux returned no active pane for that session, OR
- the `list-panes` shell-out failed, OR
- the enrichment helper was unable to identify which pane is active.

A row's `pane` field SHALL be an object (with possibly-null nested
fields) when any pane data was successfully fetched.

#### Scenario: Active session surfaces full pane payload
- **GIVEN** a memon-* tmux session whose active pane has command `claude`, path `/path/to/run-dir`, and title `✻ Claude — Building digest…`
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** the corresponding row carries `pane: { currentCommand: 'claude', currentPath: '/path/to/run-dir', title: '✻ Claude — Building digest…' }`

#### Scenario: Manual session with bare shell surfaces shell as command
- **GIVEN** a memon-manual-foo session whose active pane is running `bash` with no OSC title set
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** the corresponding row carries `pane: { currentCommand: 'bash', currentPath: <some-path>, title: <hostname-or-similar> }`

#### Scenario: Session with no pane info surfaces null
- **GIVEN** the host's tmux is reachable for `tmux ls` but `tmux list-panes -a` fails (e.g. permissions race)
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** every row's `pane` field is `null` and the response still returns 200

#### Scenario: Backward-compatible response shape
- **GIVEN** an older client that does not read the `pane` field
- **WHEN** the client deserializes the API response
- **THEN** the existing top-level fields (`sessionName`, `parsed`, `liveEntry`, `tmuxCreatedAt`, `tmuxLastActivity`, `matchable`, `staleReason`) remain present and have the same shape and types

### Requirement: GET /api/tmux-sessions/:name returns a single enriched row

The web backend SHALL expose `GET /api/tmux-sessions/:name` returning
`{ row: TmuxSessionRow }` for the named session, using the same
enrichment helper and cache as `GET /api/tmux-sessions`. The `:name`
parameter SHALL be URL-decoded before validation.

Validation rules:
- `:name` SHALL match `^memon-[A-Za-z0-9._-]+$`. Reject with 400 if
  not.
- After validation, the server SHALL attempt to find the named row in
  the enriched inventory. If absent (no matching `memon-*` session on
  the host), respond with 404 + `{ error: { code: 'NOT_FOUND',
  message } }`.

Auth: the endpoint SHALL be classified as a `shell`-class route under
`auth-system`, matching the existing classification of the prefix
`/api/tmux-sessions` (see `apps/web/lib/auth/route-classes.ts`).
Owner-only. Viewer share cookies SHALL NOT grant access — anonymous
and viewer requests return 401 with `WWW-Authenticate: Basic
realm="memon"`. Route-class tests SHALL cover both `GET
/api/tmux-sessions/<name>` and the existing `DELETE
/api/tmux-sessions/<name>` to confirm the prefix-based rule covers
both verbs.

The GET handler SHALL cohabit the existing
`apps/web/app/api/tmux-sessions/[name]/route.ts` file alongside the
existing `DELETE` export. Both verbs SHALL operate on the same path
template `/api/tmux-sessions/:name`.

#### Scenario: GET returns enriched row for known session
- **GIVEN** `memon-claude-project-a--run--foo-260507-103000` exists on the host
- **WHEN** an authenticated client sends `GET /api/tmux-sessions/memon-claude-project-a--run--foo-260507-103000`
- **THEN** the response is 200 with `{ row: TmuxSessionRow }` where `row.sessionName` matches and `row.pane` is populated per the row shape requirement above

#### Scenario: GET 404 on unknown session
- **WHEN** an authenticated client sends `GET /api/tmux-sessions/memon-manual-doesnotexist` and that session is not on the host
- **THEN** the response is 404 with `{ error: { code: 'NOT_FOUND', message } }`

#### Scenario: GET 400 on malformed name
- **WHEN** the user sends `GET /api/tmux-sessions/not-a-memon-prefix`
- **THEN** the response is 400 (validation fail)

#### Scenario: GET hits the shared 800 ms pane cache
- **GIVEN** `GET /api/tmux-sessions` just populated the cache 100 ms ago
- **WHEN** an authenticated client sends `GET /api/tmux-sessions/<some-memon-row>`
- **THEN** no new `tmux list-panes -a` shell-out is invoked; the response is served from the cached map

#### Scenario: Anonymous request rejected
- **WHEN** an anonymous client sends `GET /api/tmux-sessions/<name>`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`

#### Scenario: Viewer share cookie does not grant access
- **GIVEN** a viewer with a `memon-shares` cookie scoped to project-a
- **WHEN** the viewer sends `GET /api/tmux-sessions/memon-claude-project-a--run--foo-...`
- **THEN** the response is 401 (shell-class routes do not decode viewer cookies — same behaviour as the existing `DELETE` on this prefix)

### Requirement: /manage/tmux cards render a pane info line under the badge row

Each session card on `/manage/tmux` SHALL render a thin **pane info
line** as a single row beneath the existing badge row, in muted
foreground color and `text-[10px]`. The line SHALL contain (in order):

1. A leading `Activity` lucide icon (`size-3`).
2. `pane.currentCommand` rendered in monospace, when non-null AND not
   in the "uninformative shell" deny-list `[bash, zsh, sh, fish, tmux]`
   OR when `pane.title` is null (so the card still shows something
   informative).
3. A separator dot (`·`) with horizontal spacing, when both the
   command and title would be rendered.
4. `pane.title` truncated to fit the remaining width with CSS
   ellipsis. The full untruncated title SHALL be the card's `title`
   attribute (browser tooltip) so the user can hover to read more.

The line SHALL NOT be rendered when:
- `row.pane === null`, OR
- both `row.pane.currentCommand` would be suppressed (deny-listed) AND
  `row.pane.title === null`.

The pane info line SHALL NOT affect card click-to-select behaviour;
it is non-interactive. Mouse events on the line SHALL propagate up to
the card body's existing select handler (no `stopPropagation` here).

#### Scenario: Card shows command + title for a Claude session
- **GIVEN** a `memon-claude-*` card whose `row.pane` has `currentCommand: 'claude'` and `title: '✻ Claude — Building digest…'`
- **WHEN** the card renders
- **THEN** the pane info line shows the `Activity` icon, the text `claude`, a `·` separator, and the truncated title `✻ Claude — Building digest…`
- **AND** hovering the card surfaces the full title via the card's `title` attribute

#### Scenario: Card with only bare shell hides command but shows hostname title
- **GIVEN** a card whose `row.pane` has `currentCommand: 'bash'` and `title: 'hostname:/path'`
- **WHEN** the card renders
- **THEN** the pane info line shows the icon + the title `hostname:/path` (no `bash` segment because `bash` is in the deny-list AND a title is available)

#### Scenario: Card with only bare shell and no title shows the command
- **GIVEN** a card whose `row.pane` has `currentCommand: 'bash'` and `title: null`
- **WHEN** the card renders
- **THEN** the pane info line shows the icon + the text `bash` (deny-list suppression is bypassed because no title is available — without the command segment the line would be blank)

#### Scenario: Card with null pane info omits the line
- **GIVEN** a card whose `row.pane === null`
- **WHEN** the card renders
- **THEN** no pane info line is in the DOM and the card does NOT reserve vertical space for it

#### Scenario: Pane info line does not eat card click
- **GIVEN** an unselected matchable card with a non-null pane info line
- **WHEN** the user clicks anywhere on the pane info line text
- **THEN** the card's select handler fires and the session becomes selected (the card gains the `border-primary` outline)

### Requirement: Right-pane header on /manage/tmux echoes pane info

The right-pane header bar on `/manage/tmux` SHALL append a `· <command> · <title>` suffix after the sessionName when the selected row's `pane` data is present. The header bar is the slim row above the inline terminal that shows the currently-selected session name plus the `Pop out` button.

Rendering rules:
- The suffix SHALL render in muted color, `text-[10px]`, monospace.
- The suffix SHALL truncate (with CSS ellipsis) so the `Pop out`
  button never wraps to a second line.
- The suffix SHALL be omitted when `row.pane === null` OR both
  `currentCommand` would be suppressed AND `title === null`.
- The deny-list of "uninformative shell" commands is identical to
  the card line's deny-list.

#### Scenario: Right-pane header shows pane info for selected Claude session
- **GIVEN** a `memon-claude-*` session is currently selected and its `row.pane` has `currentCommand: 'claude'` and `title: '✻ Claude — Building digest…'`
- **WHEN** the right-pane header renders
- **THEN** the header shows the sessionName, a `·` separator, the text `claude`, another `·`, and the truncated title `✻ Claude — Building digest…`
- **AND** the `Pop out` button is still visible on the right side and is not wrapped to a new line

#### Scenario: Right-pane header shows nothing when pane data is missing
- **GIVEN** a session is selected and its `row.pane === null`
- **WHEN** the right-pane header renders
- **THEN** only the sessionName + `Pop out` button are visible (the suffix is absent)
