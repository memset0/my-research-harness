---
name: memon-digest-journal
description: Read JOURNAL.md events, write a markdown digest summarizing what happened, then optionally update `last_digest_at`. Use when the user wants to consolidate raw event lines into a human-readable summary.
argument-hint: <optional theme or window for the digest>
license: MIT
metadata:
  author: memset0
  version: "0.1.0"
---

# memon-digest-journal

The **only skill** allowed to update `last_digest_at` in JOURNAL.md
frontmatter. Run on demand (no fixed cadence) to consolidate raw event
lines into a human-readable summary.

## What this skill produces

Per invocation, **zero or more** digest files. Each one is either a fresh
new file (`D<N>-<slug>.md`) OR an in-place edit of an existing digest.
The shape is whatever matches the user's intent for this run — there's
no fixed mode taxonomy to pick from. When the user's intent is clear
(either from how they invoked the skill, or from prior context), proceed
directly; only stop and ask when something is genuinely ambiguous and a
wrong guess would write the wrong thing.

## Digests are theme-driven, not time-driven

A digest collects evidence that supports a coherent **topic** (a hypothesis
investigation, a writeup, a sprint recap, …). It is NOT a contiguous time
window or a strict claim of "everything that happened between X and Y is
in here".

Concretely:

- **Periods may be discontinuous.** When a follow-up experiment lands two
  weeks later but is logically part of the same investigation, append its
  events to the original digest — the digest's frontmatter records two
  separate periods, not a single span.
- **Periods may overlap across digests.** Two digests writing about the
  same week through different lenses (e.g. "H3 evidence" vs "weekly
  recap") will both reference some of the same events. That's fine.
- **A few off-topic noise events inside a digest are acceptable.** If
  scoping the period perfectly excludes 3 unrelated `[NOTE]` lines, but
  including them keeps the periods clean, just include them and move on.
  The digest is curated narrative, not a database query result.
- Agents may, when the user asks, **read the entire journal and pick
  disjoint windows** that fit the digest's theme — i.e. multiple
  `--since`/`--until` ranges, or a single broader read followed by `jq`
  filtering.

## File naming

Digests live at `<projectRoot>/docs/digests/D<N>-<slug>.md`:

- `D` capital letter — the namespace prefix (mirrors `H1`, `H2` for hypotheses).
- `<N>` decimal integer — the next available number across the whole `docs/digests/` directory. List existing `D*-*.md` and pick `max(N) + 1`.
- `<slug>` lowercase kebab-case, ~3-6 words describing the period or theme. Examples: `D1-bf16-sweep-recap`, `D2-h7-investigation`, `D3-pre-may-cleanup`.

Do **not** use date-based names (`<yyyy>-W<n>.md`) — the numbering scheme
is the canonical identifier (just like hypotheses).

## Frontmatter shape

```yaml
---
id: D<N>
periods:
  - { start: 2026-04-27T00:00:00+08:00, end: 2026-05-04T11:30:00+08:00 }
created_at: 2026-05-04T11:35:00+08:00
updated_at: 2026-05-04T11:35:00+08:00
---
```

- `periods` — list of `{start, end}` covering the time windows the agent
  consulted while writing this digest. One entry for a contiguous window;
  multiple entries for discontinuous spans. Not a strict membership claim
  — minor noise events inside a period are fine.
- `created_at` — ISO8601 with timezone offset, set once at file creation
  and **never changed**.
- `updated_at` — ISO8601 with timezone offset, equals `created_at` at
  file creation; bumped to "now" on every subsequent append.

## Watermark (`last_digest_at`) advancement

`last_digest_at` is the high-water mark for **the default starting cursor
of the next digest**, not a strict "everything before this is digested"
claim. After an invocation:

- If the user asked you to consume "the events since `last_digest_at`"
  for at least one digest in this run (whether new or appended), advance
  `last_digest_at` to the MAX timestamp of those events.
- If the user explicitly asked for an out-of-band / arbitrary-window
  digest that does NOT consume the cursor (e.g. a writeup about
  something from two weeks ago), leave `last_digest_at` exactly where
  it was for that part of the work.
- Mixed runs are allowed: some events go into a continuation-style
  digest (advance), others into an out-of-band one (no advance). Compute
  the new watermark from only the continuation-style subset.

Always show the user the proposed new `last_digest_at` value before
calling `digest-mark`, with a one-line reason. Never silently rewind it
(only ever move forward in time).

## Workflow

The skill runs as a free-form conversation, not a fixed multiple-choice
flow. **Match the user's intent** — when they've said clearly what they
want (e.g. "give me a digest for last week", "append the H3 stuff to
D2"), translate that into the right writes and proceed; you don't need
to re-ask. When their request is ambiguous, or they're hands-off ("just
do it"), survey first and confirm before writing. The bar is "would the
user object if I just did this?" — if no, do it; if yes, ask.

### 1. Survey existing digests + pending events (when needed)

When the user's request needs context (which digest to append to, which
events are pending, which slug to pick), run a quick survey:

```sh
# What's already in docs/digests/ ?
ls "$PROJECT_ROOT/docs/digests/D"*-*.md 2>/dev/null

# Where's the cursor?
JOURNAL_JSON=$(memon journal read --project-root "$PROJECT_ROOT" --limit 1000)
LAST=$(echo "$JOURNAL_JSON" | jq -r .lastDigestAt)

# Pending = events at or after last_digest_at
PENDING=$(memon journal read --project-root "$PROJECT_ROOT" --since "$LAST" --limit 1000)
```

If the user's request is ambiguous, show a 1-screen summary first
(existing digests with id + slug + periods, count of pending events,
tag/experiment breakdown). If their request is clear, the survey is
internal — you just need it to pick the right D-id, slug, and period.
For theme-driven requests (e.g. "summarize the H3 investigation"), read
whatever windows are needed even if they fall outside the pending range.

### 2. Translate the user's intent into write actions

Map whatever the user said into: which new digests to create, which
existing digests to append to, the events going into each, and which
ones should contribute to advancing `last_digest_at`.

Some shapes you'll commonly land on:

- "Just write one new digest covering everything since the last cursor."
- "Append the H3 events to D2; everything else into a fresh D5."
- "I want a writeup of the bf16 work from two weeks ago — don't touch
  the cursor."
- "Mostly continuation, but skip the noisy CREATE-then-FAILED churn from
  yesterday."

If the user is hands-off ("just do it"), the default is a single new
continuation digest covering everything since `last_digest_at`. Propose
the slug + show the draft, then proceed.

### 3. For each new digest

Pick the next D-id:

```sh
NEXT_N=$(ls "$PROJECT_ROOT/docs/digests/D"*-*.md 2>/dev/null \
  | sed -E 's|.*/D([0-9]+)-.*\.md|\1|' \
  | sort -n | tail -1)
NEXT_N=$((${NEXT_N:-0} + 1))
```

Ask the user for the slug (or derive one — 3-5 words kebab-case from the
theme). Write to `<projectRoot>/docs/digests/D<N>-<slug>.md`, creating
`docs/digests/` if absent. Use the frontmatter shape above. Body:

```markdown
# D<N>: <human-readable title>

<prose summary, ~200-400 words>

## Stats (optional)

- experiments created: ...
- status transitions: ...
- ...
```

### 4. For each append to an existing digest

Open `<projectRoot>/docs/digests/D<id>-<slug>.md`. Add a new section at
the end:

```markdown
## Update <ISO date of this run>

<prose summary of the appended subset, ~100-300 words>

(period: <ISO of earliest> → <ISO of latest>)
```

Update the frontmatter:

- Append a new `{start, end}` to `periods` covering the new subset (or
  merge with the last period if it's a strict extension; either is
  acceptable).
- Set `updated_at` to "now" in ISO8601 with timezone offset.
- Leave `created_at` untouched.

### 5. Group + summarize content (applies to every section)

Within each digest's prose, group events by category:

- **Experiments created** (`CREATE`) — list ids + names
- **Status transitions** (`STATUS`) — group by destination
- **Agent observations** (`NOTE`) — paraphrase the most important
- **Open requests** (`REQUEST`) — list verbatim; these are the action items
- **Errors** (`ERROR`) — group by symptom
- **Archived runs** (`ARCHIVE`) — list briefly

Reference experiment ids inline.

### 6. Show the proposed plan + drafts

Surface the plan as inline markdown — the writes you intend to do and
the watermark advancement you intend to apply:

```
About to write:
- new file: docs/digests/D5-bf16-sweep-recap.md  (12 events from the cursor → now)
- append to: docs/digests/D2-h7-investigation.md (3 H3 follow-up events)
- new file: docs/digests/D6-pre-may-cleanup.md   (writeup, doesn't advance cursor)

last_digest_at will advance:
  from: 2026-05-02T20:00:00+08:00
  to:   2026-05-04T11:30:00+08:00
  (= MAX timestamp from the events that went into D5 + D2; D6 is a writeup
   so its events don't count)
```

When the user has been clear about what they want, you can proceed and
just show the result. When the request was loose ("just do it") or you
made a non-trivial judgment call (e.g. picking which events count as
"about H3"), pause for confirmation before writing — drafts inline so
they can correct course cheaply.

### 7. Apply the writes + advance the watermark

Apply the file writes (in order: new files first, then appends).

Advance the watermark only if at least one digest in this run consumed
events for cursor purposes:

```sh
memon journal digest-mark \
  --project-root "$PROJECT_ROOT" \
  --at "<MAX timestamp from above>"
```

If every digest in this run was a non-cursor writeup, **do not call
digest-mark**.

## Constraints

- ✅ Match the user's intent — when their direction is clear, just do it; when it isn't, survey + check
- ✅ One invocation can produce multiple digest files and / or append to multiple existing ones
- ✅ Numbering is global across `docs/digests/` and never recycled
- ✅ Digest files (new or appended) are the only artifacts written
- ❌ Never appends events to JOURNAL — the digest is a separate artifact
- ❌ Never modifies experiment READMEs
- ❌ Never advances `last_digest_at` based on out-of-band / writeup events
- ❌ Never advances `last_digest_at` past the latest event that contributed to the cursor
- ❌ Never silently rewinds `last_digest_at` (advancing only moves forward in time)

## Errors

| exit | meaning |
|---|---|
| 0 | digest(s) written; if applicable, watermark advanced |
| 2 | BAD_REQUEST (e.g., `--at` not ISO8601 with offset) |
| 1 | other failure |
