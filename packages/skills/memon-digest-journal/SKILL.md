---
name: memon-digest-journal
description: Run an integrity sweep over the project's experiments, fix what needs fixing in conversation with the user, then produce a date-keyed digest covering everything since the last digest cursor and advance `last_digest_at`. The "doctor" skill is folded in — issue triage happens here, not separately.
argument-hint: <usually empty; the skill works out the window automatically>
disable-model-invocation: true
license: MIT
metadata:
  author: memset0
  version: "0.2.0"
---

# memon-digest-journal

The **only** skill that updates `last_digest_at` in JOURNAL.md
frontmatter. Each invocation:

1. Snapshots a single non-overlapping time window since the previous
   digest cursor.
2. Runs the integrity sweep formerly known as `memon-doctor` (FINISHED
   w/ no Result, stale RUNNING, parse errors, orphan hypothesis refs,
   …) and walks the user through fixing each issue.
3. Writes a digest into `<projectRoot>/docs/digests/D<N>-<YYYY-MM-DD>.md`
   covering that window — same date → same file (appended), new date →
   new file with the next global N.
4. Advances `last_digest_at` to the snapshot point.

There is **no** separate `memon-doctor` skill. The integrity sweep only
makes sense as a precondition for advancing the cursor — running them
together avoids the "I ran doctor but forgot to digest after fixing"
failure mode.

For theme-driven, free-form narratives that DON'T touch the cursor (e.g.
"everything I learned about H7 across the past three weeks"), use
`memon-write-report` instead — that's a separate, cursor-independent
artifact at `docs/reports/R<N>-<slug>.md`.

## File naming

Digests live at `<projectRoot>/docs/digests/D<N>-<YYYY-MM-DD>.md`:

- `D` capital prefix.
- `<N>` global decimal counter — `max(N) + 1` across the whole
  `docs/digests/` directory. List existing `D*-*.md` to compute it.
- `<YYYY-MM-DD>` is the local-time date of this invocation
  (`date +%Y-%m-%d`). Both informative and the dedup key:
  - if a `D*-${today}.md` already exists, **append** to it.
  - otherwise **create** `D<N+1>-${today}.md`.

User does not pick a slug or pick the file — date and global N are both
auto-assigned.

## Coverage model — strictly non-overlapping intervals

Each digest covers an interval `(prev_last_digest_at, INVOCATION_TIME]`,
where:

- `prev_last_digest_at` is whatever the JOURNAL frontmatter says when
  the skill starts (or the oldest event's timestamp if `null`).
- `INVOCATION_TIME` is **captured at skill start** and held fixed for
  the entire run.

Consecutive digests are exactly adjacent: `digest_n.to == digest_{n+1}.from`.
No gaps, no overlaps. This eliminates the "did I already digest this
event?" question.

If the same date sees two invocations, the second's window starts where
the first's ended (because the first advanced `last_digest_at`). The
second appends to the same date's file with its own coverage entry.

## Concurrency safety

Holding a stable `INVOCATION_TIME` snapshot is what makes this race-safe
even when other agents / humans are appending events concurrently:

- Events with timestamp **>** `INVOCATION_TIME` are visible (they're in
  JOURNAL on disk) but **deliberately ignored** for this digest. They
  belong to the next one.
- The skill MUST also remember `OBSERVED_LAST_DIGEST_AT` (the cursor
  value at skill start) and re-read the cursor immediately before
  calling `digest-mark`. If the on-disk value differs, another digest
  ran in parallel — surface the race to the user, leave the digest file
  in place, and **do not advance** the cursor (the user resolves
  manually).

Carry both `INVOCATION_TIME` and `OBSERVED_LAST_DIGEST_AT` through the
entire conversation; do not lose them across the doctor / interactive
phase.

## Frontmatter

```yaml
---
id: D<N>
date: 2026-05-04
covers:
  from: 2026-05-02T20:00:00+08:00
  to:   2026-05-04T11:30:00+08:00
created_at: 2026-05-04T11:35:00+08:00
updated_at: 2026-05-04T11:35:00+08:00
---
```

- `covers.from` — set once at file creation, never moves.
- `covers.to` — bumped on each in-day re-invocation that extends the
  window (still strictly non-overlapping with the next day's digest).
- `created_at` — set once, never moves.
- `updated_at` — bumped on every write.
- **No `periods` list** — the digest covers a single contiguous window.
  For discontinuous theme-based collections, use `memon-write-report`.

## Body shape

```markdown
# D<N>: <YYYY-MM-DD>

<prose summary of this digest's window, ~300-500 words, grouped by:>

- Experiments created (CREATE)
- Status transitions (STATUS)
- Agent observations (NOTE)
- Open requests (REQUEST)
- Errors (ERROR)
- Archived runs (ARCHIVE)

## Integrity sweep

<bulleted summary of what the doctor pass found and what was done about each:
 "fixed", "downgraded to FAILED", "archived by user later", "skipped (deferred)">

## Update <later-time>      ← added by an in-day re-invocation
<events from the new sub-window>
```

## Workflow

### 1. Snapshot the window

Capture `INVOCATION_TIME` and `OBSERVED_LAST_DIGEST_AT` at the very
start, before doing anything else. **Hold them in conversation memory
through the entire run.**

```sh
INVOCATION_TIME=$(date -Iseconds)
JOURNAL_JSON=$(memon journal read --project-root . --limit 1000)
OBSERVED_LAST_DIGEST_AT=$(echo "$JOURNAL_JSON" | jq -r .lastDigestAt)
```

If `OBSERVED_LAST_DIGEST_AT` is `null`, this is the first digest — set
it to the timestamp of the oldest event (or just empty-string and treat
the entire journal as in scope).

### 2. Read events in window

```sh
EVENTS=$(memon journal read --project-root . \
  --since "$OBSERVED_LAST_DIGEST_AT" --limit 1000 \
  | jq --arg until "$INVOCATION_TIME" \
       '.events |= map(select(.timestamp <= $until))')
```

(`memon journal read` doesn't take `--until` directly in v1; the jq
filter does the upper bound.)

### 3. Integrity sweep (formerly `memon-doctor`)

```sh
REPORT=$(memon doctor --project-root . --format json)
```

The CLI returns a list of issues with `experimentId / code / severity /
message / suggestedAction`. Codes (v1):

| code | severity | typical fix |
|---|---|---|
| `MISSING_RESULT` | warn | write Result via `memon experiment readme write`, or `status set FAILED` |
| `MISSING_CONCLUSION` | warn | write Conclusion |
| `FAILED_NO_NOTE` | info | write a 1-line failure note in Result via `readme write` |
| `STALE_RUNNING` | info | check process; `status set FAILED` if dead, skip if still alive |
| `PARSE_ERROR` | error | inspect README, fix structure, save via `readme write` |
| `PARSE_WARNING` | warn | inspect, decide |
| `ORPHAN_HYPOTHESIS_REF` | warn | edit README to fix the H-id, or add the hypothesis to HYPOTHESES.md |

(Note: archive is not in this list — the user reviews failed runs in the
web UI and archives there. Don't propose `archive` from this skill.)

Walk the user through the issues one at a time:

```
[<severity>] <experimentId>  <code>
  <message>
  → <suggestedAction>

What to do? (1) fix in editor / (2) downgrade status / (3) skip
```

Each fix MUST carry `--expected-mtime` from a fresh
`memon show <id> --format json`; on CONFLICT (exit 9), refresh and ask
the user how to merge. After each action, re-run `memon doctor` to
confirm the issue is gone (or explicitly track "skipped" for the digest
body's integrity-sweep section).

Helper for the README-rewrite fixes (most common path):

```sh
# fix_readme <id> <new-body-on-stdin> → echoes new mtime on success.
# Exits 9 on CONFLICT (caller decides whether to retry); 1 on other failure.
fix_readme() {
  local id="$1" body
  body=$(cat)
  local mtime
  mtime=$(memon show "$id" --project-root . --format json | jq -r .mtime)
  local out rc
  out=$(printf '%s' "$body" \
        | memon experiment readme write "$id" --project-root . \
            --expected-mtime "$mtime")
  rc=$?
  case "$rc" in
    0) echo "$out" | jq -r .mtime ;;
    9) echo "CONFLICT" >&2; return 9 ;;
    *) echo "WRITE_FAILED rc=$rc" >&2; return 1 ;;
  esac
}

# Usage:
NEW_MTIME=$(fix_readme "$EXP_ID" <<EOF
$NEW_README_BODY
EOF
)
```

For status-only fixes (e.g. downgrade FINISHED → FAILED), use
`memon experiment status set --to <STATUS> --expected-mtime <mtime>`
with the same fresh-mtime discipline; the helper above is for full
README rewrites.

### 4. Determine the target file

```sh
TODAY=$(date -d "$INVOCATION_TIME" +%Y-%m-%d 2>/dev/null \
        || date -j -f "%Y-%m-%dT%H:%M:%S%z" "$INVOCATION_TIME" "+%Y-%m-%d")
EXISTING=$(ls "docs/digests/D"*-"${TODAY}".md 2>/dev/null | head -1)

if [ -n "$EXISTING" ]; then
  TARGET="$EXISTING"     # append mode
else
  NEXT_N=$(ls "docs/digests/D"*-*.md 2>/dev/null \
    | sed -E 's|.*/D([0-9]+)-.*\.md|\1|' \
    | sort -n | tail -1)
  NEXT_N=$((${NEXT_N:-0} + 1))
  TARGET="docs/digests/D${NEXT_N}-${TODAY}.md"
fi
```

### 5. Write the digest

**New file**: full frontmatter + body (events grouped + integrity-sweep
section).

**Append to existing**: extend `covers.to` to `$INVOCATION_TIME`, bump
`updated_at`, and append a `## Update <ISO>` section to the body. Don't
touch `covers.from` or `created_at`.

Show the draft inline before writing. After the user confirms, write
the file.

### 6. Race check, then advance the watermark

We only need the `last_digest_at` field of JOURNAL.md frontmatter — no
need to call `memon journal read` (which would also re-parse all
events) for that. Plain awk on the frontmatter is enough:

```sh
CURRENT_LAST_DIGEST_AT=$(awk '
  /^---$/ { c++; next }
  c == 1 && /^last_digest_at:/ { sub(/^last_digest_at:[ \t]*/, ""); print; exit }
' JOURNAL.md)

if [ "$CURRENT_LAST_DIGEST_AT" != "$OBSERVED_LAST_DIGEST_AT" ]; then
  # Another digest finished in parallel.
  # Surface to the user; DO NOT advance the cursor; DO NOT roll back
  # the digest file we already wrote (let the user reconcile manually).
  exit 1
fi

memon journal digest-mark --project-root . --at "$INVOCATION_TIME"
```

The race happens when two parallel `memon-digest-journal` invocations
overlap. The second one to reach this step sees a different cursor and
backs out cleanly. The user can then look at both digest files, decide
how to merge, and manually `digest-mark` if desired.

## Constraints

- ✅ `INVOCATION_TIME` and `OBSERVED_LAST_DIGEST_AT` are captured at
  start and never recomputed mid-run.
- ✅ Each digest covers a strict, non-overlapping interval; consecutive
  digests are adjacent.
- ✅ Same date → append to the existing date's file. New date → new
  file with the next global N.
- ✅ Doctor checks happen before the digest body is finalized; user
  walks through fixes interactively.
- ✅ Race-safe via re-read of `last_digest_at` immediately before
  `digest-mark`.
- ❌ Never advance `last_digest_at` past `INVOCATION_TIME`.
- ❌ Never advance `last_digest_at` if the race check fails.
- ❌ Never silently rewind `last_digest_at` (only ever forward).
- ❌ Never include events with timestamp > `INVOCATION_TIME` in this
  digest, even if they're already on disk.
- ❌ Don't write reports here — those are `memon-write-report`'s job.
  Reports and digests are separate artifacts in separate directories.
- ❌ Don't propose `archive` from this skill — the user does that on
  the web UI at their own pace.

## Errors

| exit | meaning |
|---|---|
| 0 | digest written + cursor advanced |
| 1 | failure (race detected, fs error, jq missing, etc.); read the message |
| 2 | BAD_REQUEST (e.g. `--at` not ISO8601 with offset) |
| 9 | CONFLICT during one of the in-loop README writes (skill should refresh + retry; if it surfaces here, the user-driven retry also conflicted) |
