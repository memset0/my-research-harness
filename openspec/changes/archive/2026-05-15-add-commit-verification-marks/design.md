## Context

Users have been browsing commit history through the new history
dialog and want to record per-commit judgments — "I checked this
one, looks good", "this one needs another pair of eyes", "this one
actually broke X". The marks need to be **portable across machines**
(they should travel with the repo) and **per-project** (different
projects accumulate different review state).

The right home is a small file inside the project's own git tree.
The dashboard reads it, the user commits it, and a clone on another
box sees the same state.

`mock/project-a/.memon/` already exists as a placeholder for
project-private memon data, so we adopt that directory as the
canonical location.

## Goals / Non-Goals

**Goals:**

- A CSV file under each project's `.memon/` directory recording one
  row per marked commit.
- Three statuses (verified / suspicious / issue), optional free-text
  note, both editable.
- The CSV file is meant to be committed to the project's git — its
  diff-friendliness matters.
- The git-history dialog renders the mark inline (colored dot in
  the commit list, editor in the detail header).
- Zero new npm dependencies.

**Non-Goals:**

- Mark history (who-marked-what-when): v1 stores only the LATEST
  status + note + updated_at. No multi-user attribution.
- Cross-project queries ("show me all `issue`-flagged commits
  across all projects"): out of scope.
- Sync / merge UI when two clones race on the same SHA: out of
  scope — git's normal merge resolution handles it.
- Linking marks to other dashboard objects (experiments, runs):
  out of scope.

## Decisions

### D1. CSV (not JSON), sorted by sha ascending

User flipped between "csv" and "json" in the request; I interpret
the consistent mentions of "csv" as the intent.

CSV beats JSON here because:

- One commit = one line — `git diff` on the file reads cleanly
  ("verified → suspicious" on row N is a one-line change).
- Sorted by SHA ascending means writes to commit A don't reorder
  rows for commit B — additions and edits land in stable
  positions.
- No nesting, no schema versioning headache.

Trade-off: JSON would make multi-field structured data slightly
easier to evolve. Mitigation: if we ever need richer per-mark data,
add columns to the CSV (header row makes it easy to detect).

### D2. CSV schema

```csv
sha,status,note,updated_at
<full 40-char SHA>,<verified|suspicious|issue>,<note>,<ISO 8601 w/ offset>
```

- Header row REQUIRED. Implementations reading the file MUST
  validate the four columns match exactly (case-sensitive, no
  trailing whitespace).
- `sha` is the FULL 40-char SHA-1 (not the short SHA). Future-proof
  against SHA-256 by lifting the length cap if needed.
- `status` is one of three literal strings. Anything else → reader
  treats the row as malformed and skips it (with a `parse_warning`
  surfaced).
- `note` MAY be empty. Notes containing commas, double-quotes, or
  newlines are quoted per RFC 4180; empty notes write as `""` (two
  adjacent commas, no quotes) so the column delimiter is preserved.
- `updated_at` is ISO 8601 with timezone offset (matches the rest
  of memon's timestamp convention from CLAUDE.md).

### D3. `<projectRoot>/.memon/commit-marks.csv`

The `.memon/` directory:

- Created lazily on first write (`fs.mkdir({ recursive: true })`).
- Not gitignored by default. Users who don't want to share marks
  can add `.memon/commit-marks.csv` to their project gitignore.
- May contain other per-project memon-private files in the
  future — we're claiming this directory as a namespace now.

### D4. Atomic writes, no mtime locking

`setCommitMark` and `deleteCommitMark` both:

1. Read the existing CSV (or treat empty if absent).
2. Apply the in-memory mutation.
3. Write to a temp file `.memon/commit-marks.csv.tmp.<pid>.<rand>`.
4. `fs.rename` to the final path (atomic on POSIX).

No mtime check — concurrent multi-tab writes race; the last writer
wins. TanStack mutations on the client invalidate the
`['commit-marks', project]` query so the next render re-reads the
on-disk state. Multi-user contention is out of the threat model
(single-user dashboard).

If this becomes a real problem later, add mtime locking like the
README writer.

### D5. Three endpoints, owner-only mutations

| Endpoint | Method | Auth |
|---|---|---|
| `/api/projects/:p/commit-marks` | GET | owner + viewer-in-scope |
| `/api/projects/:p/commit-marks/:sha` | PUT | owner only (403 for viewers) |
| `/api/projects/:p/commit-marks/:sha` | DELETE | owner only (403 for viewers) |

Read access for viewers mirrors the rest of the dashboard's read
posture. Mutations require owner (the rest of the write surface —
README, status, archive, share creation, etc. — is owner-only too).

### D6. `sha` validation

Same safe-ref character class as the existing history endpoints:
`/^[A-Za-z0-9_\-/.~^]+$/`, length ≤ 200. The CSV reader and writer
do NOT validate SHA format beyond this — a future caller could in
principle store a non-SHA key, but the only call sites we add pass
real commit SHAs from `git log`.

### D7. UI integration in the history dialog

Two touchpoints inside `<GitHistoryDialog />`:

1. **Commit list rows** — each row gains a leading
   `<CommitMarkBadge />`. For an unmarked commit the badge renders
   an empty placeholder of the same width (so rows stay aligned)
   but is visually invisible. Tooltip on hover shows the status
   label + note (when present).
2. **Selected-commit detail header** — `<CommitMarkEditor />`
   renders inline with the metadata block. It contains:
   - Three colored radio buttons (verified / suspicious / issue)
   - A "clear" button (only when a mark exists)
   - An optional `<Textarea>` for the note
   - A "Save" button that's disabled until the form is dirty

The editor uses TanStack `useMutation` for write/delete with
optimistic updates so the badge in the commit list updates
immediately.

### D8. `<CommitMarkBadge />` reusable shape

```tsx
<CommitMarkBadge
  mark={mark | undefined}   // undefined = unmarked
  size?: 'sm' | 'md'        // small for list rows, medium elsewhere
/>
```

Implementation: a `<span>` with a fixed footprint to keep row
alignment, an inner `<span>` with the colored dot when marked,
plus a Radix `<Tooltip>` wrapping the whole thing. The tooltip
content shows the status label and (when present) the note text.

### D9. Status → color mapping

| Status | Token (light) | Description |
|---|---|---|
| `verified` | `bg-emerald-500` | confirmed correct |
| `suspicious` | `bg-amber-500` | doubts, needs another look |
| `issue` | `bg-destructive` | actually broken |

These map to existing Tailwind tokens; the destructive token is
already F4-verified. The emerald/amber utilities are pure Tailwind
v4 utilities that don't depend on shadcn theme tokens, so no extra
CSS-variable definitions needed.

## Risks / Trade-offs

- **[Race: two tabs write to the same SHA at the same instant]**
  → atomic rename means the second write overwrites the first
  cleanly; the client whose mutation lost gets the merged state on
  its next refetch (TanStack mutation invalidates the query). No
  data corruption, just a tiny "last writer wins" surprise. Spec
  documents this.
- **[User forgets to `git add .memon/commit-marks.csv`]** → marks
  exist locally but don't propagate. We don't auto-stage; this is
  user discipline. The dashboard could surface "uncommitted marks
  file" in the existing git-status pill in a follow-up.
- **[Malformed CSV row from a previous tool / merge conflict]** →
  the reader skips malformed rows and surfaces a `parse_warning`
  array alongside the parsed marks. The dialog could surface a
  toast; v1 just logs to the server.
- **[CSV grows unbounded]** → 100 KB caps fine for tens of
  thousands of marks. Not a practical concern.
- **[Removing the `.memon/` directory entirely]** → marks vanish.
  This is the user's own action; we don't guard against it.

## Migration Plan

Pure additive. No existing schema changes, no on-disk migration.
First write creates `.memon/` if missing.

- Deploy → existing projects with no marks: dialog renders
  unchanged badges (invisible placeholders). New mark on first
  click creates the file.
- Rollback → revert the change set; existing
  `.memon/commit-marks.csv` files remain on disk but become inert
  (no reader, no UI). Re-rolling forward restores access.

## Open Questions

- **Should we render the badge inline with the commit-list row's
  SHA span, OR as a leading column with its own slot?** Decision:
  leading column with its own slot, so unmarked rows reserve the
  badge width and rows stay aligned. Implementer's call to
  fine-tune the exact width.
- **Should marks survive a rebase / squash that rewrites SHAs?**
  v1 says no — marks are keyed by SHA. If the user rewrites
  history, the marks for the old SHAs orphan. Future enhancement
  could store `(subject, authorDate)` as a secondary key for
  best-effort recovery.
