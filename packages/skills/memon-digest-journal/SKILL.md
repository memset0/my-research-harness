---
name: memon-digest-journal
description: Read JOURNAL.md events since `last_digest_at`, write a markdown digest summarizing what happened, then update `last_digest_at`. Use when the user asks for a weekly/sprint summary of journal activity.
license: MIT
metadata:
  author: memon
  version: "0.1.0"
---

# memon-digest-journal

The **only skill** allowed to update `last_digest_at` in JOURNAL.md
frontmatter. Run periodically (weekly is typical) to consolidate raw event
lines into a human-readable summary.

## Workflow

### 1. Read the watermark

```sh
JOURNAL_JSON=$(memon journal read --project-root "$PROJECT_ROOT" --limit 1000)
LAST=$(echo "$JOURNAL_JSON" | jq -r .lastDigestAt)
NOW=$(date -Iseconds)  # or whatever produces ISO8601 with offset
```

If `last_digest_at` is `null`, this is the first digest — start from the
oldest event.

### 2. Read events since the watermark

```sh
EVENTS=$(memon journal read \
  --project-root "$PROJECT_ROOT" \
  --since "$LAST" \
  --limit 1000)
```

### 3. Group + summarize

Group events by category (one paragraph per group):

- **Experiments created** (`CREATE` events) — list ids + names
- **Status transitions** (`STATUS` events) — group by status, e.g. "5 went FINISHED, 2 FAILED, 1 still RUNNING"
- **Agent observations** (`NOTE`) — paraphrase the most important 5-10
- **Open requests** (`REQUEST`) — list verbatim; these are the action items
- **Errors** (`ERROR`) — group by symptom

Aim for ~300-500 words. Reference experiment ids inline (the digest will
typically be linked from the web journal view).

### 4. Write the digest somewhere structured

Default location: `<projectRoot>/docs/digests/<yyyy-Www>.md`. Create the
directory if absent. Filename uses ISO week (e.g. `2026-W18.md`).

Frontmatter for the digest file:

```markdown
---
period_start: 2026-04-27T00:00:00+08:00
period_end:   2026-05-04T00:00:00+08:00
events_consumed: 47
---
```

Then the prose summary, then optionally a "Stats" section with counts.

### 5. Show the user the draft and ask for confirmation

**Do not call `digest-mark` until the user has accepted the digest.** This
is a destructive operation — once `last_digest_at` advances, future digest
runs won't re-process those events.

### 6. Mark the digest as done

After user accepts:

```sh
memon journal digest-mark \
  --project-root "$PROJECT_ROOT" \
  --at "$NOW"
```

Output:

```json
{ "ok": true, "lastDigestAt": "<NOW>", "path": "/abs/JOURNAL.md" }
```

## Constraints

- ✅ This skill writes one new file (the digest under `docs/digests/`) and
  updates one frontmatter field (`last_digest_at`)
- ❌ Never appends events to JOURNAL — the digest is a separate artifact
- ❌ Never modifies experiment READMEs
- ❌ Never updates `last_digest_at` to a time before the latest event
  consumed (would re-process events on the next run)

## Errors

| exit | meaning |
|---|---|
| 0 | digest-mark succeeded |
| 2 | BAD_REQUEST (e.g., `--at` not ISO8601 with offset) |
| 1 | other failure |
