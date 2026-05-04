---
name: memon-doctor
description: Scan a memon project for incomplete or inconsistent experiments (FINISHED with no Result, stale RUNNING, parse errors, orphaned hypothesis refs) and walk the user through fixing each one. Use when the user wants to clean up project state.
license: MIT
metadata:
  author: memon
  version: "0.1.0"
---

# memon-doctor

Interactive maintenance. The CLI command `memon doctor` does the detection
(pure scan, no writes). This skill drives the **fix** loop.

## Workflow

### 1. Scan

```sh
REPORT=$(memon doctor --project-root "$PROJECT_ROOT" --format json)
```

Output shape:

```jsonc
{
  "scannedAt": "...",
  "projectRoot": "...",
  "issues": [
    { "experimentId", "code", "severity", "message", "suggestedAction" }
  ],
  "summary": { "total", "byCode": {...}, "bySeverity": {...} }
}
```

If `summary.total === 0`, you're done — tell the user "all clean".

### 2. Show the summary

Brief: "found N issues — M errors, K warnings, J infos". Don't list all of
them yet.

### 3. Iterate per issue

For each issue, present:

```
[<severity>] <experimentId>  <code>
  <message>
  → <suggestedAction>

What to do? (1) fix in editor / (2) downgrade status / (3) archive / (4) skip
```

Then act based on the answer:

| code | typical fixes |
|---|---|
| `MISSING_RESULT` | (1) write Result via `memon experiment readme write` / (2) `status set FAILED` / (3) `archive` |
| `MISSING_CONCLUSION` | (1) write Conclusion / (3) `archive` |
| `FAILED_NO_NOTE` | (1) write a 1-line failure note in Result via `readme write` |
| `STALE_RUNNING` | check if process is alive; (2) `status set FAILED` if dead, (4) skip if still alive |
| `PARSE_ERROR` | (1) inspect README, fix the YAML/section structure, save via `readme write` |
| `PARSE_WARNING` | (1) inspect, decide |
| `ORPHAN_HYPOTHESIS_REF` | (1) edit README to fix the H-id / (1) edit HYPOTHESES.md to add the missing entry |

Always:

- Read fresh mtime via `memon show <id> --format json` before any write
- Use the suggestedAction as the default option
- After each action, re-run `memon doctor` and confirm the issue is gone

### 4. Done state

When the user picks (4) on the last remaining issue, or all issues are
resolved, summarize:

```
fixed: 5 issues
skipped: 2 issues (left for you to handle later)
```

## Constraints

- ✅ Never make changes silently — always confirm with the user
- ✅ Always pass `--expected-mtime` on README writes; on CONFLICT (exit 9),
  re-read mtime and ask the user how to merge
- ✅ When archiving, append a JOURNAL `[ARCHIVE]` event automatically (the
  CLI does this for you)
- ❌ Never bulk-archive without per-issue confirmation
- ❌ Never delete files (archive ≠ delete; the run dir stays on disk)

## Quick mode

If the user says "just fix the obvious ones automatically":

- `MISSING_CONCLUSION` on a FINISHED run with a non-empty Result →
  acceptable to copy the Result's last sentence into Conclusion as a stub
  and ask the user to refine later. Tell them you did this.
- `FAILED_NO_NOTE` → grep the last 5 lines of `<runDir>/run.log` for the
  most recent error, drop that into Result. Tell them you did this.
- Everything else still requires confirmation.
