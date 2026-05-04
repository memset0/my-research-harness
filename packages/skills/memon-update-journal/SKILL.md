---
name: memon-update-journal
description: Append a single event to a memon project's JOURNAL.md (NOTE / REQUEST / ERROR / ARCHIVE / CREATE). Use when an agent wants to record an observation or open a question without modifying any experiment's README.
license: MIT
metadata:
  author: memon
  version: "0.1.0"
---

# memon-update-journal

Append exactly one event line to `<projectRoot>/JOURNAL.md`. Never modifies
the file's frontmatter (only `memon-digest-journal` is allowed to do that).

## When to use

- You observed something cross-cutting that doesn't belong in any single
  experiment's README ("memory leaks above 32B context length on this box")
- You want to **request** something from the human user when they next
  check in ("please verify H7 is still aligned with the new SLURM quotas")
- You want to record an error or warning that needs human attention
- The user asks you to "leave a note in the journal"

## When NOT to use

- ❌ For status changes — those go through `memon experiment status set`,
  which emits a `[STATUS]` event automatically
- ❌ For digest summaries — that's `memon-digest-journal`'s job
- ❌ For things that belong in an experiment's README sections (Motivation,
  Method, Result, Conclusion, Caveats) — write those into the README

## Tags

| tag | when |
|---|---|
| `NOTE` | freeform observation |
| `REQUEST` | something for the human to handle next |
| `ERROR` | error or warning that should be visible in the timeline |
| `ARCHIVE` | recorded automatically by `memon experiment archive` — don't emit manually |
| `CREATE` | recorded automatically by `memon new` — don't emit manually |

`STATUS` is **rejected** by `memon journal append` (CLI returns
`BAD_REQUEST`, exit code 2). Use `memon experiment status set` instead.

## Workflow

1. Confirm `--project-root` (default cwd if unspecified).
2. Pick the tag (default `NOTE` unless the user said otherwise).
3. (Optional) include `--experiment-id <id>` to associate the event with a
   specific run.
4. Run the CLI:

```sh
memon journal append \
  --project-root "$PROJECT_ROOT" \
  --tag NOTE \
  --experiment-id "foo-260504-141512" \
  --body "8B fp16 sweep converged faster than the bf16 reference; possible Adam-state cancellation effect"
```

Output (JSON to stdout):

```json
{ "ok": true, "appended": 1, "timestamp": "2026-05-04T14:18:00+08:00", "path": "/abs/JOURNAL.md" }
```

## Composing the body

- One sentence, declarative, no leading "I think" / "we should"
- For a REQUEST, end with a question mark or a clear ask
- If the observation is about a specific experiment, **always** pass
  `--experiment-id` — it lets the journal view filter cleanly later
- Don't paste log excerpts (use the experiment's `## Caveats` section for those)

## Errors

| exit | meaning |
|---|---|
| 0 | appended |
| 2 | BAD_REQUEST (e.g., empty body, `--tag STATUS`, unknown tag) |
| 1 | other failure (fs error, etc.) |
