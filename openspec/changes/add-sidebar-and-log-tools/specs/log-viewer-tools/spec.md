## ADDED Requirements

### Requirement: Backend log file enumeration

The backend SHALL expose `GET /api/log-files?expPath=<path>` returning a list of log-shaped files (extensions `.log`, `.txt`, `.out`, `.err`) discovered inside the experiment directory. Discovery SHALL include the experiment directory itself plus a one-level scan of any `logs/` subdirectory.

#### Scenario: Multiple files discovered
- **WHEN** the experiment directory contains `logs/stdout.log`, `logs/stderr.log`, and `train.out`
- **THEN** the response is `{ files: [{ name, path, size, mtime }, ...] }` with all three entries, sorted by `mtime` descending

#### Scenario: No log files
- **WHEN** the experiment directory has no matching files
- **THEN** the response is `{ files: [] }` (NOT 404)

#### Scenario: Path safety
- **WHEN** `expPath` resolves outside any configured project root
- **THEN** the response is 403 with the standard error envelope

### Requirement: Log viewer multi-file tab switcher

The LogViewer component SHALL render a tab strip listing all files returned by `/api/log-files`. Switching tabs SHALL re-initialize the SSE stream and the LineIndex state for the newly-selected file.

#### Scenario: Switch tab
- **WHEN** the user clicks the `stderr.log` tab while viewing `stdout.log`
- **THEN** the SSE connection to `/api/log/stream?path=.../stdout.log` is closed, a new one to `.../stderr.log` is opened, the line buffer resets, and the initial last-100-lines fetch is re-issued

#### Scenario: Default tab
- **WHEN** the viewer initializes
- **THEN** the first tab is the file with the largest `mtime` (most recently active log); if `stdout.log` exists, it's almost always picked because trainings write to it last

### Requirement: In-log substring search with highlight and navigation

The LogViewer SHALL provide a search input. When the user types a query, all matches in the currently-rendered lines SHALL be visually highlighted (e.g., yellow background), and a counter `<current> / <total>` SHALL display next to the input. `<` / `>` buttons SHALL cycle through matches, scrolling each into view.

#### Scenario: Substring match
- **WHEN** the user types `loss` in the search input
- **THEN** every occurrence of the substring `loss` (case-insensitive) inside the rendered lines is wrapped in a `<mark>`-style highlight; the counter shows e.g. `1 / 23`

#### Scenario: Cycle through matches
- **WHEN** the user presses the `>` button (or Enter in the input)
- **THEN** the next match is selected, scrolled into view, and visually distinguished from the other matches (e.g., orange vs yellow)

#### Scenario: Empty query
- **WHEN** the search input is empty
- **THEN** no highlighting is applied and the counter is hidden

#### Scenario: Search persists across follow updates
- **WHEN** the search query is active and a new line containing a match arrives via SSE
- **THEN** the new line's match is highlighted on render and the counter total increments

### Requirement: ANSI escape-code coloring

LogViewer SHALL parse ANSI SGR escape sequences (e.g. `\x1b[31m`, `\x1b[1m`, `\x1b[0m`) in line text and render them with appropriate text color / weight / opacity instead of showing the raw escape characters.

Library: `anser` (zero-dependency, ~5KB). Mapping (selected):
- `fg: red` → `text-red-400`
- `fg: green` → `text-emerald-400`
- `fg: yellow` → `text-amber-300`
- `fg: blue` → `text-sky-400`
- `fg: magenta` → `text-fuchsia-400`
- `fg: cyan` → `text-cyan-300`
- `bold` → `font-bold`
- `dim` → `opacity-60`

#### Scenario: ANSI red rendered as red text
- **WHEN** a log line contains `\x1b[31mERROR\x1b[0m: out of memory`
- **THEN** the rendered output shows the word `ERROR` in red and the rest as default; no literal `\x1b[31m` characters appear

#### Scenario: Bold + color combined
- **WHEN** a line contains `\x1b[1;33mWARN\x1b[0m`
- **THEN** the word `WARN` renders in bold yellow

#### Scenario: Unknown / unsupported sequences ignored gracefully
- **WHEN** a sequence we don't map (e.g. blink, reverse-video) appears
- **THEN** the surrounding text still renders without the literal escape characters; the unsupported attribute is silently dropped

### Requirement: Line selection with URL hash permalinks

LogViewer SHALL allow the user to click a line number to select that line. Shift-clicking another line number SHALL select the inclusive range. Selection SHALL be reflected in the URL hash:
- Single line: `#L<n>`
- Range: `#L<a>-L<b>` (with `a < b`)

When a URL with a `#L*` hash is loaded, the viewer SHALL scroll the indicated range into view AND visually highlight it (distinct from search-match highlight).

#### Scenario: Single-line select
- **WHEN** the user clicks the line number `123`
- **THEN** the URL hash becomes `#L123`, line 123 has a "selected" treatment (e.g. left border accent)

#### Scenario: Range select
- **WHEN** the user clicks line `123` then shift-clicks line `130`
- **THEN** the URL hash becomes `#L123-L130`, lines 123 through 130 are highlighted

#### Scenario: Open via permalink
- **WHEN** the user opens a URL like `.../experiments/<id>#L500-L510` and the file has 50,000 lines
- **THEN** LogViewer loads enough lines around line 500 (e.g. via a targeted `GET /api/log?endLine=560&count=120` if not already in buffer), scrolls to that range, and highlights lines 500-510

#### Scenario: Hash cleared on selection clear
- **WHEN** the user clicks somewhere outside any line number to clear selection
- **THEN** the URL hash is removed (without triggering a page reload)
