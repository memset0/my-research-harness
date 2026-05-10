---
name: memon-write-report
description: Author or update a theme-driven report (`docs/reports/R<NNNN>-<slug>.md`) drawn from the project's JOURNAL. The report records the shell selector used to assemble it, so re-running the selector cheaply tells whether new events have landed since the last update.
argument-hint: <theme of the report; or existing R-id to update>
disable-model-invocation: true
license: MIT
metadata:
  author: memset0
  version: "0.1.0"
---

# memon-write-report

A **report** is a theme-driven, user-curated narrative built from JOURNAL
events. It does NOT advance any cursor. It does NOT have to cover a
contiguous period. Multiple reports may overlap in time. Reports
co-exist with the daily-cadenced **digests** produced by
`memon-digest-journal` — they're separate artifacts for separate jobs:

| | digest | report |
|---|---|---|
| cadence | one per calendar date, automatic | on demand, theme-driven |
| time scope | strict non-overlapping window between consecutive digests | arbitrary, possibly disjoint |
| advances `last_digest_at` | yes | **no** |
| filename | `D<NNNN>-<YYYY-MM-DD>.md` | `R<NNNN>-<slug>.md` |
| typical use | "what happened since last digest + integrity sweep" | "everything I learned about H0007 across the past 3 weeks" |

## Preflight — FS convention version

Run `memon fs-version check --project-root . --format json` as the first
step. If `status !== "match"`, STOP and follow the branch protocol in
`../PREFLIGHT.md` (covers `match` / `behind` / `uninitialised` / `ahead`).

## File naming

Reports live at `<projectRoot>/docs/reports/R<NNNN>-<slug>.md`:

- `R` capital prefix — the namespace marker (mirrors `H<NNNN>` for hypotheses, `D<NNNN>` for digests).
- `<NNNN>` 4-digit zero-padded counter — next available across the whole `docs/reports/` directory. List existing `R*-*.md`, take the numeric max, `+1`, and `printf '%04d'`.
- `<slug>` lowercase kebab-case, ~3-6 words describing the theme. E.g. `R0001-bf16-investigation`, `R0002-h0007-followup`, `R0003-aug-debug-log`.

## Frontmatter

```yaml
---
id: R<NNNN>
title: <human-readable title>
created_at: 2026-05-04T14:30:00+08:00
updated_at: 2026-05-04T14:30:00+08:00
selector: |
  # Single shell snippet that selects this report's events from the JOURNAL.
  # Re-run this on demand to check whether new events qualify for inclusion.
  # Run from <projectRoot> — the `.` in `--project-root .` resolves to it.
  memon journal read --project-root . --since 2026-04-15T00:00:00+08:00 --limit 1000 \
    | jq '.events[] | select((.experimentId // "") | startswith("bf16-"))'
---
```

Field rules:

- `selector` — **required**. A bash snippet (multi-line is fine) that
  emits the JOURNAL events the report draws from. The snippet should be
  re-runnable: invoking it later returns the **current** matching event
  set, including any that have landed since the report was written. The
  agent uses this to detect "is there new evidence since the last
  update?" without re-deriving filters from scratch.

  Use whatever combination of `memon journal read` flags + `jq` filters
  expresses the theme. Examples:

  ```bash
  # all events touching experiments with id prefix "bf16-"
  memon journal read --project-root . --limit 1000 \
    | jq '.events[] | select((.experimentId // "") | startswith("bf16-"))'

  # all NOTE/REQUEST events mentioning "H0007" in the body
  memon journal read --project-root . --tag NOTE --limit 1000 \
    | jq '.events[] | select(.body | contains("H0007"))'

  # everything between two specific dates, no other filter
  memon journal read --project-root . \
    --since 2026-04-01T00:00:00+08:00 --limit 1000 \
    | jq '.events[] | select(.timestamp <= "2026-04-30T23:59:59+08:00")'
  ```

- `created_at` — set once at file creation, **never changed**.
- `updated_at` — equals `created_at` at creation; bumped on every update.
- **No `periods`, no `events_consumed`** — the selector replaces both.
  Actual coverage is whatever the selector currently returns.

## Body shape

```markdown
# R<NNNN>: <title>

<prose narrative, ~200-500 words, free-form; references experiment ids inline>

## Update <ISO date>      ← added by every subsequent update

<prose covering what's new since the previous update>
```

## Workflow — new report

1. **Decide the theme** with the user (`H0007 investigation`, `bf16 sweep
   recap`, `pre-may cleanup`, …) and pick a slug.
2. **Construct the selector**. Write the bash snippet that filters
   JOURNAL down to the events the theme covers. Verify it returns
   non-empty by running it.
3. **Pick the next R-id** and pad to 4 digits:
   ```sh
   NEXT_N=$(ls "$PROJECT_ROOT/docs/reports/R"*-*.md 2>/dev/null \
     | sed -E 's|.*/R([0-9]+)-.*\.md|\1|' \
     | sort -n | tail -1)
   NEXT_N=$((${NEXT_N:-0} + 1))
   FILENAME=$(printf 'R%04d-%s.md' "$NEXT_N" "$SLUG")
   # → e.g. R0007-bf16-investigation.md
   ```
4. **Draft the body** from the selector's output. Group events by
   category (CREATE / STATUS / NOTE / REQUEST / ERROR / ARCHIVE),
   reference experiment ids inline, ~200-500 words. Show the draft
   inline so the user can correct course before any write.
5. **Write** `<projectRoot>/docs/reports/R<NNNN>-<slug>.md` with the
   frontmatter (selector embedded verbatim) + body.

## Workflow — update an existing report

1. Open `<projectRoot>/docs/reports/R<id>-<slug>.md` and read its
   frontmatter `selector` block.
2. Re-run the selector. Diff against what's already covered in the body
   (heuristic: any event whose timestamp is newer than the report's
   `updated_at`).
3. If nothing new, tell the user "no new events match" and stop.
4. Otherwise, draft an `## Update <ISO date>` section summarizing the
   new events; show inline.
5. On confirm, **append** the new section to the file body. Update
   `updated_at` to "now". Leave `created_at`, `id`, `title`, `selector`
   alone (unless the user explicitly wants to refine the selector — in
   which case write a small note in the Update section).

## Constraints

- ✅ Always record the `selector` verbatim in frontmatter — the user
  must be able to re-run it without rebuilding the filter from memory.
- ✅ Show drafts inline before any file write; user can correct course.
- ✅ Numbering is global across `docs/reports/` and never recycled.
- ❌ **Never call `memon journal digest-mark`** — reports don't touch
  the cursor.
- ❌ Never modify experiment READMEs.
- ❌ Never modify other reports (one invocation = one report touched).
- ❌ Never reorder or delete prior `## Update` sections — appends only.

## Errors

| exit | meaning |
|---|---|
| 0 | report written / updated |
| 1 | failure (fs error, selector returned non-JSON, etc.) |
