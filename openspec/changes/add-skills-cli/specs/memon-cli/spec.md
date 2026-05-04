## ADDED Requirements

### Requirement: `--project-root` flag bypasses config.yml entirely

All read subcommands (`list` / `show` / `search` / `hypo list` / `hypo show` / `scan`) AND the new write subcommands SHALL accept a `--project-root <path>` flag. When given, the command SHALL treat that path as a single anonymous project's root and SHALL NOT attempt to read `config.yml` from any location. `--project-root` SHALL be mutually exclusive with `--config` and `--project NAME`; using both SHALL exit with code 2 and a `BAD_REQUEST` error.

#### Scenario: `--project-root` works without any config file present
- **WHEN** the user runs `memon list --project-root /tmp/some/project` on a host with no `config.yml` anywhere
- **THEN** the command treats `/tmp/some/project` as the project root, scans it, and outputs the experiment list as JSON; exit 0

#### Scenario: Mutual exclusion with --config
- **WHEN** the user runs `memon list --project-root /a --config /b/config.yml`
- **THEN** the command exits 2 with stderr `{"error":{"code":"BAD_REQUEST","message":"--project-root cannot be combined with --config or --project"}}`

#### Scenario: Path doesn't exist
- **WHEN** the user runs `memon list --project-root /does/not/exist`
- **THEN** the command exits 4 with stderr `{"error":{"code":"NOT_FOUND","message":"project root does not exist: ..."}}`

### Requirement: `memon scan <project-root>` returns the full project snapshot

`memon scan <project-root>` SHALL output a single JSON document containing every structured piece of state under that project root: experiments (with full parsed sections), hypotheses, journal events. The output shape SHALL match this contract exactly so callers can parse it without conditionals:

```jsonc
{
  "projectRoot": "<abs path>",
  "scannedAt":   "<ISO8601 with offset>",
  "experiments": [
    { "id", "path", "mtime", "hasReadme", "frontMatter", "sections", "parseErrors": [], "parseWarnings": [], "stale" }
  ],
  "hypotheses": { "legendBlock", "summaryTableBlock", "entries": [...], "parseErrors": [], "parseWarnings": [] },
  "journal":    { "lastDigestAt", "events": [...] }
}
```

Default JSON; `--format human` SHALL emit a tabular human summary.

#### Scenario: Scan a populated project
- **WHEN** the user runs `memon scan ./mock/project-a`
- **THEN** stdout is JSON with `experiments.length === 5` (matching the fixture), `hypotheses.entries.length === 6`, `journal.events.length > 0`; exit 0

#### Scenario: Scan an empty project root
- **WHEN** the user runs `memon scan /tmp/empty-dir` where the dir exists but has no experiment subdirs and no HYPOTHESES/JOURNAL
- **THEN** stdout is JSON with `experiments: []`, `hypotheses: { entries: [], summaryTableBlock: null, ... }`, `journal: { lastDigestAt: null, events: [] }`; exit 0

#### Scenario: Scan output JSON shape matches the web `/api/scan` if implemented
- **WHEN** any consumer parses the output of `memon scan`
- **THEN** field names and types are identical to what the web backend returns at `/api/scan` (or would return if the web `scan` route were implemented identically — same Zod schema)

### Requirement: `memon journal append` is the only path for non-STATUS events

`memon journal append --project-root <path> --tag <TAG> --body <BODY> [--experiment-id <id>] [--at <ISO>]` SHALL append a single event line to `<projectRoot>/JOURNAL.md`. The command SHALL NOT touch the file's frontmatter, including `last_digest_at`. Allowed tags: `NOTE` / `REQUEST` / `ERROR` / `ARCHIVE` / `CREATE`. The tag `STATUS` SHALL be rejected with `BAD_REQUEST` — STATUS events are emitted automatically by `memon experiment status set`.

#### Scenario: Append a NOTE
- **WHEN** the user runs `memon journal append --project-root ./mock/project-a --tag NOTE --body "agent observation" --experiment-id foo-260501-100000`
- **THEN** the JOURNAL gains exactly one new line `- <ISO> [NOTE] \`foo-260501-100000\` agent observation`
- **AND** the file's frontmatter `last_digest_at` is unchanged
- **AND** stdout is `{"ok":true,"appended":1,"timestamp":"<ISO>"}`; exit 0

#### Scenario: Reject STATUS tag
- **WHEN** the user runs `memon journal append ... --tag STATUS --body "..."`
- **THEN** the command exits 2 with stderr `{"error":{"code":"BAD_REQUEST","message":"STATUS events must be emitted via 'memon experiment status set'"}}`
- **AND** the JOURNAL is untouched

#### Scenario: Project root has no JOURNAL.md yet
- **WHEN** the user runs `journal append` on a fresh project root with no JOURNAL.md
- **THEN** the command creates JOURNAL.md with a frontmatter `last_digest_at: null` block and appends the event line; exit 0

### Requirement: `memon journal digest-mark` is the only path that updates `last_digest_at`

`memon journal digest-mark --project-root <path> --at <ISO>` SHALL atomically update the `last_digest_at` field in `<projectRoot>/JOURNAL.md` frontmatter to the given timestamp. The command SHALL NOT modify any event lines. The command SHALL be the only CLI entrypoint that mutates frontmatter (concretely: only path that calls `updateLastDigestAt` from `@memon/core`).

#### Scenario: Update last_digest_at
- **WHEN** the user runs `memon journal digest-mark --project-root ./mock/project-a --at 2026-05-04T10:00:00+08:00`
- **THEN** JOURNAL.md frontmatter shows `last_digest_at: 2026-05-04T10:00:00+08:00`
- **AND** all event lines below the frontmatter are byte-identical to before
- **AND** stdout is `{"ok":true,"lastDigestAt":"2026-05-04T10:00:00+08:00"}`; exit 0

#### Scenario: Invalid ISO timestamp
- **WHEN** `--at` is not a valid ISO8601 string with offset
- **THEN** exit 2 with `BAD_REQUEST`

### Requirement: `memon journal read` exposes paged query

`memon journal read --project-root <path> [--since <ISO>] [--tag <TAG>] [--experiment-id <id>] [--limit <N>]` SHALL parse the project's JOURNAL.md and emit `{"events":[...],"lastDigestAt":"..."}`. Filters compose AND-style. Default `--limit` is 200, max 1000.

#### Scenario: Filter by tag and experiment
- **WHEN** the user runs `memon journal read --project-root ./mock/project-a --tag NOTE --experiment-id foo-260501-100000`
- **THEN** only events whose tag is `NOTE` and whose experimentId matches are returned

### Requirement: `memon experiment status set` writes README + appends [STATUS] atomically

`memon experiment status set <id> --project-root <path> --to <STATUS> --expected-mtime <ms>` SHALL:
1. Read the experiment's README.md
2. Verify its mtime matches `--expected-mtime`; if not, exit 9 with `CONFLICT` and emit current content + mtime to stdout
3. Update the front-matter `status` field
4. Atomically write the new README (temp file + rename)
5. Append a `[STATUS]` event to JOURNAL.md if status actually changed

If the experiment has no README, the command SHALL exit 4 with `NOT_FOUND`.

#### Scenario: Successful status set
- **WHEN** the user runs `memon experiment status set foo-260501-100000 --project-root ./mock/project-a --to FINISHED --expected-mtime <current>`
- **THEN** README front-matter `status: FINISHED`; JOURNAL has a new `[STATUS]` event line; stdout `{"ok":true,"mtime":<new-mtime>,"prevStatus":"...","nextStatus":"FINISHED"}`; exit 0

#### Scenario: mtime conflict
- **WHEN** `--expected-mtime` is stale
- **THEN** exit 9 with stderr `{"error":{"code":"CONFLICT","message":"on-disk mtime differs"},"currentMtime":<n>,"currentContent":"<full readme>"}` and stdout = the current README content (so a skill can pipe it directly into a diff or re-decide); the file on disk is untouched

#### Scenario: Status unchanged → no JOURNAL event
- **WHEN** the requested status equals the current status
- **THEN** the README is rewritten (new mtime returned) but no JOURNAL event is appended; stdout has `journalAppended: false`

### Requirement: `memon experiment readme write` reads content from stdin

`memon experiment readme write <id> --project-root <path> --expected-mtime <ms> [--expected-hash <sha1>]` SHALL read the new README content from stdin (until EOF) and apply the same atomic-write + mtime-lock + JOURNAL-status-event protocol as `experiment status set`. If `--expected-hash` is provided and the on-disk content's sha1 differs, the command SHALL exit 9 with `CONFLICT` even when mtime matches (defends against low-resolution mtime on NFS).

#### Scenario: Successful overwrite
- **WHEN** the user pipes new content into `memon experiment readme write foo-260501-100000 --project-root ./mock/project-a --expected-mtime <current>`
- **THEN** the README is replaced atomically; if status changed, a `[STATUS]` event is appended; stdout `{"ok":true,"mtime":<new>,"journalAppended":true|false}`; exit 0

#### Scenario: Hash mismatch with matching mtime
- **WHEN** `--expected-mtime` matches but `--expected-hash` does not
- **THEN** exit 9 with `CONFLICT`; file unchanged

### Requirement: `memon experiment archive` toggles the `.archived` sidecar

`memon experiment archive <id> --project-root <p>` SHALL create an empty file at `<runDir>/.archived`. `memon experiment unarchive <id> --project-root <p>` SHALL remove that file (or no-op if it doesn't exist). Both commands SHALL append a single `[ARCHIVE]` event to JOURNAL.md (body: `\`<id>\` archived` or `\`<id>\` unarchived`). Neither command SHALL modify README.md or its mtime.

#### Scenario: Archive a run
- **WHEN** the user runs `memon experiment archive foo-260501-100000 --project-root ./mock/project-a`
- **THEN** `<runDir>/.archived` exists (size 0)
- **AND** README.md mtime is unchanged
- **AND** JOURNAL.md has a new `[ARCHIVE]` event line for that id
- **AND** stdout is `{"ok":true,"archived":true}`; exit 0

#### Scenario: Unarchive
- **WHEN** the user runs `memon experiment unarchive foo-260501-100000 --project-root ./mock/project-a` after a previous archive
- **THEN** `<runDir>/.archived` is gone, README.md mtime unchanged, JOURNAL appended with an unarchive note; stdout `{"ok":true,"archived":false}`

#### Scenario: Unarchive a non-archived run
- **WHEN** unarchive is called on a run that has no `.archived` sidecar
- **THEN** the command exits 0 with `{"ok":true,"archived":false,"noop":true}` and does NOT write a JOURNAL event

### Requirement: Read commands honor archive filter via `--include-archived`

`list` / `scan` / `show` / `search` / `journal read` / `hypo list` / `hypotheses read` / `doctor` SHALL skip experiments whose run directory contains `.archived` by default. A `--include-archived` flag SHALL include them. An `--archived-only` flag SHALL include only archived runs (useful for digest / cleanup workflows).

#### Scenario: list excludes archived by default
- **WHEN** the user archives `foo-260501-100000` then runs `memon list --project-root ./mock/project-a`
- **THEN** `foo-260501-100000` is NOT in the output

#### Scenario: list --include-archived
- **WHEN** the user runs `memon list --project-root ./mock/project-a --include-archived`
- **THEN** archived runs are present in the output, each with an `archived: true` field on the experiment record

#### Scenario: --archived-only
- **WHEN** the user runs `memon list --project-root ./mock/project-a --archived-only`
- **THEN** only archived runs are returned

### Requirement: `memon doctor` reports incomplete-state issues without writing

`memon doctor --project-root <p> [--include-archived] [--severity <min>]` SHALL scan the project root, run a fixed set of consistency rules, and emit an issue list. The command SHALL NOT modify any file on disk. Exit code SHALL reflect the highest severity present: `0` when no issues or only `info`/`warn`; `1` when at least one `error` issue is reported. The `--severity` flag (default `info`) filters issues at or above that level.

The rule set v1:

| `code` | `severity` | trigger |
|---|---|---|
| `MISSING_RESULT` | `warn` | `status === 'FINISHED'` and `sections.result` is missing or only whitespace |
| `MISSING_CONCLUSION` | `warn` | `status === 'FINISHED'` and `sections.conclusion` missing |
| `FAILED_NO_NOTE` | `info` | `status === 'FAILED'` and `sections.result` is empty |
| `STALE_RUNNING` | `info` | `status === 'RUNNING'` and `isStaleRunning` returns true |
| `PARSE_ERROR` | `error` | `parseErrors.length > 0` |
| `PARSE_WARNING` | `warn` | `parseWarnings.length > 0` |
| `ORPHAN_HYPOTHESIS_REF` | `warn` | front matter `hypotheses[]` contains an id NOT present in HYPOTHESES.md `entries[].id` |

Output shape:

```jsonc
{
  "scannedAt": "<ISO>",
  "projectRoot": "<abs>",
  "issues": [
    { "experimentId", "code", "severity", "message", "suggestedAction" }
  ],
  "summary": {
    "total": <n>,
    "byCode":     { "MISSING_RESULT": <n>, ... },
    "bySeverity": { "error": <n>, "warn": <n>, "info": <n> }
  }
}
```

#### Scenario: FINISHED run with empty Result
- **GIVEN** an experiment whose front matter has `status: FINISHED` and whose `## Result` section is missing
- **WHEN** the user runs `memon doctor --project-root <p>`
- **THEN** the issues array contains one entry with `code: "MISSING_RESULT"` for that experiment id

#### Scenario: PARSE_ERROR triggers exit 1
- **GIVEN** at least one experiment whose README has a parse error
- **WHEN** the user runs `memon doctor`
- **THEN** the issue list contains a `severity: "error"` entry and the command exits with code 1

#### Scenario: Doctor ignores archived runs by default
- **GIVEN** an archived FINISHED experiment with empty Result
- **WHEN** `memon doctor` runs without `--include-archived`
- **THEN** that experiment does NOT appear in the issues array

#### Scenario: --severity filter
- **WHEN** the user runs `memon doctor --severity warn`
- **THEN** issues with `severity: "info"` are filtered out of the output (but still counted in `summary.bySeverity`)

### Requirement: `memon hypotheses read` mirrors the web API

`memon hypotheses read --project-root <path>` SHALL output `{path, legendBlock, summaryTableBlock, entries, parseErrors, parseWarnings}` matching the web `/api/hypotheses` JSON exactly. (The existing `memon hypo list/show` commands continue to work for human use; this is the agent-shaped equivalent.)

#### Scenario: Read mock hypotheses
- **WHEN** the user runs `memon hypotheses read --project-root ./mock/project-a`
- **THEN** stdout JSON has `entries.length === 6` and the same field names as `/api/hypotheses`

### Requirement: Stable exit-code dictionary

The CLI SHALL use this exit code table for all subcommands. Skills depend on these for branch logic.

| code | semantic |
|---|---|
| 0 | success |
| 1 | generic / unclassified failure |
| 2 | usage / flag error (commander default) |
| 4 | NOT_FOUND (resource doesn't exist) |
| 9 | CONFLICT (mtime / hash lock failure — skill should refresh and retry) |
| 13 | FORBIDDEN (path safety / permission) |

#### Scenario: Skill retries on exit 9
- **WHEN** any write command exits with code 9
- **THEN** the stderr JSON has `error.code === "CONFLICT"` and stdout/stderr include enough state for the caller to retry without losing intent (current mtime + current content for README writes; current frontmatter for digest-mark)

### Requirement: Optional cross-process scan cache (deferred — contract only)

The CLI and web backend SHALL respect the env var `MEMON_SCAN_CACHE`: when **unset or `0`** the system SHALL behave as if no on-disk scan cache exists (this is the v1 default — no cache implementation lives in this change). When set to `1`, both surfaces SHALL read and write a snapshot file at `~/.cache/memon/scan/<sha1(absoluteProjectRoot)>/snapshot.json` according to the contract below. **v1 of `add-skills-cli` does not implement the `=1` branch** — this Requirement freezes the format so a future change can flip the switch without renegotiating the spec.

- **Location**: cache files SHALL live at `~/.cache/memon/scan/<sha1(absoluteProjectRoot)>/snapshot.json`
- **Snapshot shape** (writers MUST emit, readers MUST tolerate exactly this shape):
  ```jsonc
  {
    "schemaVersion": 1,
    "projectRoot": "<abs>",
    "writtenAt": "<ISO with offset>",
    "experiments": [{ "id", "path", "mtimeMs", "size" }, ...],
    "hypothesesMtimeMs": <n|null>,
    "journalMtimeMs":    <n|null>,
    "snapshot": { /* full `memon scan` output */ }
  }
  ```
- **Validation**: on a cache hit, consumers SHALL re-`fs.stat` every entry in `experiments[].path`, `HYPOTHESES.md`, `JOURNAL.md`. Any mtime mismatch SHALL invalidate the entire snapshot; the consumer MUST then fall back to a full rescan and overwrite the snapshot.
- **Atomic write**: writers MUST use `snapshot.json.tmp.<rand>` followed by `rename`; partial writes are forbidden.
- **Cross-process safety**: concurrent writers may race the rename — the loser SHALL accept the winner's snapshot without retrying (the next consumer re-validates freshness regardless).
- **Disposability**: deleting `~/.cache/memon/scan/` MUST never cause data loss; it only forces a rescan.

#### Scenario: Cache off (v1 default)
- **WHEN** `MEMON_SCAN_CACHE` is unset or `=0`
- **THEN** every `memon scan` invocation walks the project root from scratch; no file in `~/.cache/memon/scan/` is created or read

#### Scenario: Cache hit (future)
- **WHEN** `MEMON_SCAN_CACHE=1` AND a snapshot exists for this root AND every recorded mtime still matches the on-disk file
- **THEN** the command returns the cached `snapshot` field directly without walking the tree (target latency < 50ms for a 200-experiment project)

#### Scenario: Cache miss due to mtime drift (future)
- **WHEN** `MEMON_SCAN_CACHE=1` AND a snapshot exists but at least one tracked path's mtime has changed
- **THEN** the cache is treated as missing; a full rescan runs and overwrites the snapshot atomically


## MODIFIED Requirements

### Requirement: Config resolution order

For all subcommands, the system SHALL resolve configuration in this order:
1. **`--project-root <path>`** (when present, **bypasses all config-loading entirely**; treats the path as a single anonymous project)
2. Explicit `--config <path>` argument
3. `<cwd>/config.yml`
4. For non-`serve` subcommands only: implicit single-project mode using cwd as that project's root

If the resolved config exists but does not parse, the command SHALL exit with a structured error and code 1. `--project-root` is mutually exclusive with `--config` and `--project NAME`; combining them SHALL exit 2.

#### Scenario: --project-root wins over everything
- **WHEN** `--project-root /a` is given AND `<cwd>/config.yml` also exists
- **THEN** `/a` is used and `config.yml` is not even read

#### Scenario: --config wins over cwd config
- **WHEN** both `<cwd>/config.yml` and `--config /tmp/other.yml` are provided (and no `--project-root`)
- **THEN** `/tmp/other.yml` is used and the cwd config is ignored

#### Scenario: Implicit cwd-as-project for `list`
- **WHEN** the user runs `memon list` with no `--project-root`, no `--config`, and no `<cwd>/config.yml`
- **THEN** the command treats cwd as a single anonymous project's root and proceeds

#### Scenario: `serve` without any config
- **WHEN** the user runs `memon serve` without `--config`, without `--project-root`, and no `config.yml` in cwd
- **THEN** the command exits with a structured error explaining how to create `config.yml`. (Note: `memon serve` does NOT support `--project-root` since the web stack requires the full config schema for multi-project setups.)

### Requirement: Default JSON output, `--format human` for human

All read subcommands (`list`, `show`, `search`, `hypo list`, `hypo show`, **`scan`**, **`hypotheses read`**, **`journal read`**) SHALL default to machine-readable JSON output on stdout to support agent consumption. A `--format human` flag SHALL switch to a tabular/colored human-readable rendering.

Write subcommands (`experiment status set`, `experiment readme write`, `journal append`, `journal digest-mark`) SHALL emit JSON status objects on stdout (`{"ok":true,...}` on success, structured error JSON on failure). They SHALL NOT have a `--format human` mode in v1; their output is intended for skill consumption.

#### Scenario: JSON list output
- **WHEN** the user runs `memon list`
- **THEN** stdout is valid JSON: `{"experiments": [...]}` with all parsed front-matter fields

#### Scenario: Human list output
- **WHEN** the user runs `memon list --format human`
- **THEN** stdout is a table with columns `id | status emoji | name | created_at | hypotheses`

#### Scenario: Write command JSON output
- **WHEN** any write subcommand succeeds
- **THEN** stdout is `{"ok":true, ...command-specific fields...}`; the command SHALL NOT print human-readable lines on stdout
