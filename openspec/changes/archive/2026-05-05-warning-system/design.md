## Context

Today, when an agent runs an experiment via `memon-run-experiment` or
sweeps the project via `memon-digest-journal`'s doctor step, it
frequently observes things that *should* be brought to the human's
attention but cannot be auto-resolved: an unexpected loss spike, a
config value that drifts from the paper's, a NaN gradient, a baseline
that no longer matches an updated comparison run, a node whose
`nvidia-smi` blipped mid-run. The agent has nowhere structured to put
these. Stuffing them into `JOURNAL.md` buries them; refusing to record
them loses information; rewriting README body sections like
`## Caveats` would conflate the human-author's prose with
agent-generated flags. The `add-memon-mvp` spec already foresaw this
gap (the README's standard sections are Motivation/Setup/Method/
Result/Conclusion/Caveats/Artifacts — none of them is a place an agent
can append into).

Real-world READMEs sometimes also contain non-standard custom sections
the user has hand-added (per CLAUDE.md "F2/F4" lessons, our parser
already tolerates this). The agent's warning writes MUST therefore not
disturb any other section, even one the spec does not know about.

## Goals / Non-Goals

**Goals:**

- Give agents a structured, append-only surface to flag findings the
  human must adjudicate.
- Keep the on-disk format human-readable and grep-friendly so a user
  can edit it directly in any text editor.
- Allow per-row interactive control in the web UI (toggle status,
  edit Note, delete row) within the existing conflict-aware save flow.
- Section-bound writes: agent appending a warning SHALL NOT race with a
  user editing `## Method` in the web editor.
- Doctor sweep proposes new warnings on past runs in light of new
  evidence, but never auto-applies them.

**Non-Goals:**

- Bumping the fs convention version. Old READMEs without `## Warnings`
  remain valid; new READMEs without `## Warnings` remain valid.
- Migrating warnings out of `README.md` into a sidecar file. They live
  in the README body so they travel with the experiment in any
  scenario (clone, archive, share).
- Rich notification / paging system. The UI surface is the experiment
  detail page and `memon doctor` output. No email, no push.
- Auto-resolving warnings based on heuristics. Resolution is a human
  act.

## Decisions

### D1. Table format, not a checkbox list

A single GFM table per experiment, columns in this fixed order:

| Status | Created | Category | Message | Resolved | Note |

- `Status` ∈ {`OPEN`, `RESOLVED`} (text, not a unicode checkbox — GFM
  task-list syntax `[ ]` is not supported inside table cells).
- `Created` is an ISO8601-with-offset timestamp set when the row is
  appended; never edited.
- `Category` is one of a closed enum (D2).
- `Message` is free-text describing what to look at. Pipes (`|`) and
  newlines MUST be escaped (`\|`, `<br>`) by the writer.
- `Resolved` is an ISO8601-with-offset timestamp filled when status
  flips to `RESOLVED`; empty (`—` or blank) when `OPEN`.
- `Note` is the human's optional resolution note (e.g. "intentional,
  A100 OOM at 512"). Free-text with same escaping rules.

Each row MUST also carry a stable, opaque `rowId` so HTTP/CLI patches
can target a specific row. We embed this in an HTML comment at the
end of the row, e.g. `<!-- id:w_2026-05-05T14-32+0800_a3f1 -->`. The
HTML comment renders invisibly in any GFM viewer but parses
deterministically.

**Alternatives considered:**

- **GFM task list (`- [ ] ...`)**: visually clean but every row would
  need an inline category tag and ad-hoc structure for `Resolved` and
  `Note`. Hard to extend.
- **Hypotheses-style expanded blocks** (one H3 per warning): too
  heavyweight; clutters the README.
- **Frontmatter array**: violates "frontmatter is schema-locked" and
  forces the user to learn YAML to edit a row.

The table balances grep-friendliness, machine-parseability, and human
edit-ability. Future migration is possible (we can switch the
representation via the `fs-convention-migration-system` change once it
lands).

### D2. Closed Category enum

`Category` ∈ {
  `methodology`,    — experimental method may be unsound
  `result`,         — output value looks anomalous
  `config`,         — parameter drifts from baseline / paper
  `data`,           — dataset / preprocessing concern
  `repro`,          — reproducibility risk
  `compare`,        — baseline / comparison drift
  `infra`,          — hardware / environment noise
  `other`           — escape hatch
}.

The parser SHALL accept any string and surface a structured warning
(`code: 'UNKNOWN_WARNING_CATEGORY'`) for values outside the enum, but
the row stays in the parsed list (don't drop the human's data). Skills
SHALL only emit values from the enum.

### D3. AI authority is strictly append-only

The CLI exposes the full set of operations (`add` / `resolve` /
`reopen` / `delete`) but **skills SHALL NOT call `resolve` /
`reopen` / `delete`**. Only the human-driven web UI and the human-typed
CLI may invoke them. This is encoded as a hard rule in `memon-skills`
spec, and skills' SKILL.md bodies explicitly forbid the ops.

Rationale: the entire point of the surface is that it requires a human
adjudication. If an agent could mark its own warning resolved the
surface would degenerate back into self-cleared noise.

The `delete` op exists at the CLI/HTTP layer because users need a way
to drop a noise row (e.g. if the agent flagged something that turned
out to be a known harmless artifact — they'd rather drop it than carry
a permanent `RESOLVED` line). Deletion is an audit-loss event but the
JOURNAL keeps a `[WARNING_DELETED]` event for traceability.

### D4. Section-bound writes

`memon experiment warning add/resolve/reopen/delete` operate on the
README via a section-bound writer:

1. Read the full README + capture `mtime` and `sha1(content)`.
2. Locate the `## Warnings` H2 line range (start = the `## Warnings`
   heading line; end = the line before the next H2, or EOF).
3. If the section is missing, insert it at the canonical position
   (after `## Caveats`, before `## Artifacts`; if either anchor is
   absent, insert before `## Artifacts` if present, else at EOF). The
   insertion point is a parser-validated structural decision, not
   line-arithmetic.
4. Apply the row mutation only within the captured line range.
5. Re-read the file, recompute `mtime` + `sha1`, and use them as
   `expectedMtime` + `expectedHash` for the `experiment readme write`
   call.
6. On exit-9 CONFLICT: re-read, re-locate the section (it may have
   moved), re-apply, retry once. Surface to the human on second
   conflict.

The section-bound writer is implemented in `@memon/core` and shared
between the CLI and the HTTP API route. We do NOT do "per-line patch"
across the wire — the API call carries the intent (`add`,
`resolve(rowId, note)`, `delete(rowId)`) and the server-side writer
materializes the README change.

### D5. Doctor sweep scope = (a) ∪ (b)

`memon-digest-journal`'s doctor step iterates the experiment set:

- (a) every experiment whose `README.md` mtime falls inside the digest
  window (or whose status changed in the journal events being
  digested), AND
- (b) every experiment that currently has at least one `OPEN` warning
  (regardless of mtime).

For each, the agent reviews the run with full context (latest journal,
new comparison runs, baseline drift) and proposes:

- new warnings to append, OR
- existing OPEN warnings to flag for human attention (e.g.,
  "still unresolved 14 days later").

The agent SHALL NOT auto-append; it surfaces a list to the user and
appends only after explicit confirmation. The `WARN_UNRESOLVED` doctor
code is informational and never blocks digest commit.

### D6. CLI surface

```
memon experiment warning add <id> --project-root <p>
    --category <cat> --message <text>
    [--expected-mtime <ms>] [--expected-hash <sha1>]
    -> {ok, rowId, mtime}

memon experiment warning list <id> --project-root <p> [--status open|resolved|all]
    -> [{rowId, status, created, category, message, resolved, note}, ...]

memon experiment warning resolve <id> <rowId> --project-root <p>
    --note <text>
    [--expected-mtime <ms>] [--expected-hash <sha1>]
    -> {ok, mtime}

memon experiment warning reopen <id> <rowId> --project-root <p>
    [--note <text>]
    [--expected-mtime <ms>] [--expected-hash <sha1>]
    -> {ok, mtime}

memon experiment warning delete <id> <rowId> --project-root <p>
    [--expected-mtime <ms>] [--expected-hash <sha1>]
    -> {ok, mtime}
```

`add` always sets status `OPEN`, captures `Created` from
`new Date().toISOString()` (with system tz offset preserved), and
generates a `rowId` server-side. `resolve` records `Resolved =
<now-ISO>` and `Note = <note>`. `reopen` clears `Resolved` and `Note`
(but keeps `Created`); the journal carries the audit trail of the
state flip.

All writes append a JOURNAL event with code `[WARNING]` carrying
`{op: 'add'|'resolve'|'reopen'|'delete', rowId, category}`. Add and
resolve include the message; delete includes the deleted row's full
content for audit reversibility.

### D7. HTTP API mirrors the CLI

```
GET    /api/experiments/:id/warnings           -> warnings[]
POST   /api/experiments/:id/warnings           -> {category, message}, returns {rowId, mtime}
PATCH  /api/experiments/:id/warnings/:rowId    -> {op:"resolve"|"reopen", note?}, returns {mtime}
DELETE /api/experiments/:id/warnings/:rowId    -> returns {mtime}
```

All routes carry `If-Match: <hash>` for conflict semantics; on 412
the client refetches and replays the patch.

### D8. Web UI

The detail page renders an additional `Warnings` section card after
`Caveats`. Each row shows status, category badge (re-using the
existing colored-badge component pattern from CLAUDE.md F3 — wrapper,
NOT a new badge variant), message, and (for RESOLVED) the timestamp +
note. Per-row controls: a status toggle (text confirm; on resolve, a
small textarea prompts for the note), a "delete" affordance behind
a confirm dialog, and an "Add warning" form at the bottom of the
section.

The Warnings card uses the same conflict-aware save flow as the README
inline editor (`expectedMtime` + `expectedHash`, 409 → refetch with
recovery). Draft autosave parity with the README editor: per-row
unsaved Note edits are persisted to localStorage with the same
7-day cleanup rule.

### D9. Skill split: append-warning vs run-experiment

A new skill `memon-append-warning` exists alongside
`memon-append-journal`. Both are model-invocable
(`disable-model-invocation` omitted) and represent the
"I noticed something on an existing experiment, append a single
record" risk tier. Calling `memon-run-experiment` just to append a
warning to an old run would be wildly disproportionate.

`memon-run-experiment` gains a §7 "post-run anomaly review" step that
runs after the README is written. The step uses the same
section-bound writer (so the post-run warning appends do not race
with a user opening the README editor mid-run).

### D10. Compatibility & migration story

- Old README without `## Warnings`: parses to `warnings: []`,
  doctor sees no `WARN_UNRESOLVED`, UI shows a "No warnings — add
  one" empty state.
- Old README with a hand-rolled `## Warnings` section that doesn't
  match our table format: parser surfaces a structured warning
  (`code: 'WARNINGS_SECTION_NOT_TABLE'`), keeps the section bytes
  intact in `experiment.warningsRaw`, and `warnings: []`. The CLI
  refuses to write into a non-conforming section (exits with a
  diagnostic asking the user to either format it as a table or
  rename it).
- Once `fs-convention-migration-system` lands, a future migration
  could rewrite the table shape (e.g. add a new column) without
  another spec rewrite here.

## Risks / Trade-offs

- **[Risk] Section-bound writer mistakenly clobbers a non-Warnings
  section if the heading detector is loose.**
  → Mitigation: detector matches on a fully-anchored regex
  (`^## Warnings\s*$`), AND the writer takes a snapshot diff
  pre/post and asserts that no line outside the captured range
  changed. If the assertion fails, the write aborts before flushing
  to disk.

- **[Risk] Concurrent edits: human is editing `## Method` in the web
  editor, agent appends a warning at the same time. Naive last-write
  wins would lose the human's prose.**
  → Mitigation: agent's append goes through a 3-way merge — the
  section-bound writer rebases its row insertion onto the latest
  README content if mtime moved, AS LONG AS the `## Warnings`
  section's pre-image is unchanged. If the Warnings section itself
  was also touched, it falls through to a normal CONFLICT and the
  agent surfaces to the user.

- **[Risk] Agent floods the README with low-signal warnings, drowning
  the real ones.**
  → Mitigation: skill text in `memon-run-experiment` explicitly
  bounds what qualifies — "needs human adjudication or carries
  reproducibility risk." Doctor's `WARN_UNRESOLVED` aggregates per
  experiment so the UI can show a "noisy run" indicator.

- **[Risk] `rowId` collision on HTML-comment-based identifiers.**
  → Mitigation: `rowId` = `w_<isoCreated-with-colons-replaced>_<4-hex>`
  with a 16-bit random suffix. Collision probability over a single
  run's lifetime is negligible; the writer rejects duplicates at
  insert time.

- **[Risk] Markdown table cells and pipe characters.**
  → Mitigation: writer escapes `|` → `\|` and `\n` → `<br>` on the
  way in; reader unescapes on the way out. The escaping rules are
  unit-tested with adversarial inputs.

- **[Risk] User edits `[OPEN]` → `[RESOLVED]` in raw text without
  filling Resolved/Note.**
  → Mitigation: parser tolerates this (status is the source of truth)
  but doctor surfaces `WARN_RESOLVED_NO_NOTE` (informational) so the
  user is reminded to fill the note next time they're in the file.

- **[Risk] Skill text drift: skills SHALL NOT call resolve/delete,
  but how do we keep that rule enforced?**
  → Mitigation: this change adds an explicit Requirement to
  `memon-skills` spec, plus a scenario that greps each
  `memon-*/SKILL.md` for `warning resolve` / `warning delete` and
  asserts no occurrence outside an explicit "anti-pattern" block.
