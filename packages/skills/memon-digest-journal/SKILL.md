---
name: memon-digest-journal
description: Run the project's integrity sweep, review/fix issues with the user, summarize the next non-overlapping Journal window into a date-keyed digest, and advance last_digest_at safely. Use for periodic status synthesis and doctor checks, including the current Experiment YAML schemas and managed-section contract.
---

# memon-digest-journal

Produce a cursor-advancing periodic digest and run the integrated integrity
sweep. Theme reports are separate and never advance the Journal cursor.

## Preflight

Run `memon --project-root . --format json fs-version check` first. Continue only
for `match`; otherwise follow `../PREFLIGHT.md`.

## Stable coverage window

At invocation start, capture:

- `INVOCATION_TIME`: ISO8601 with timezone offset;
- `OBSERVED_LAST_DIGEST_AT`: the current Journal cursor.

The digest covers `(OBSERVED_LAST_DIGEST_AT, INVOCATION_TIME]`. Events arriving
later belong to the next digest even if visible before this workflow completes.
Carry both values unchanged through the interactive integrity sweep.

```sh
INVOCATION_TIME=$(date -Iseconds)
JOURNAL_JSON=$(memon --project-root . journal read --limit 1000)
OBSERVED_LAST_DIGEST_AT=$(printf '%s' "$JOURNAL_JSON" | jq -r .lastDigestAt)
```

For a null cursor, cover from the oldest event. Read events through the fixed
upper bound; never use “now” again later.

## Integrity sweep

Run:

```sh
memon --project-root . --format json doctor
```

The sweep must inspect current Experiment bundles as well as Runs, hypotheses,
and Journal state. Triage at least:

- malformed/missing README frontmatter or canonical sections;
- unknown/duplicate Experiment headings (reported but never hidden/deleted);
- managed-section pointer conflicts;
- missing/invalid/ahead/behind YAML `schema_version`;
- invalid YAML fields or status values;
- duplicate IDs, missing references, dependency cycles;
- Investigation references to unknown Variants;
- Variant references to missing, foreign, or duplicated Runs;
- a Run present in both `runs` and `attempts`;
- Variant/Run status contradictions;
- parent/child terminal-status contradictions;
- stale active Runs and terminal Runs with incomplete `Result`;
- `RESOLVED` Experiments with empty Conclusion;
- invalid hypothesis references and open Warnings.

Strict linting must not become lossy repair. Unsupported sections and virtual
section conflicts remain visible. For an Experiment semantic fix, invoke
`memon-write-experiment-doc`; never call the deprecated warning CLI or rewrite
the bundle inside this skill. Re-run doctor after each accepted fix.

For every issue, show the evidence and one recommended action in Chinese. Let
the user choose fix/defer when interpretation is required. Record `fixed`,
`deferred`, or `unresolved` in the digest. Do not advance the cursor while a
doctor error that makes the digest materially unreliable remains unresolved.

## Digest file

Use `docs/digests/D<NNNN>-<YYYY-MM-DD>.md`:

- local date comes from `INVOCATION_TIME`;
- use the next global zero-padded D ID for a new date;
- append an Update section to the existing same-date digest;
- never merge discontinuous windows.

Frontmatter:

```yaml
---
id: D0007
date: 2026-08-10
covers:
  from: 2026-08-09T08:00:00+00:00
  to: 2026-08-10T08:00:00+00:00
created_at: 2026-08-10T08:05:00+00:00
updated_at: 2026-08-10T08:05:00+00:00
---
```

On same-date update, preserve `id`, `date`, `covers.from`, and `created_at`;
advance `covers.to`, update `updated_at`, and append `## Update <ISO time>`.

## Synthesis

Draft a concise narrative grouped by meaningful changes rather than dumping
events. Include:

- Experiments created or resolved;
- Implementation and Investigation progress;
- new/changed Variants and selected Results;
- failed/interrupted Attempts and recovery implications;
- new Findings, Limitations, Conclusions, and Warnings;
- hypothesis changes, open requests, errors, and archives;
- the integrity-sweep outcome.

Render relevant structured sections when needed:

```sh
memon --project-root . --format human experiment doc render <id> investigation
memon --project-root . --format human experiment doc render <id> results
```

Do not infer evidence from a hard-coded Run count. Preserve the distinction
between Runs selected as Results and discarded Attempts.

Show the draft before writing when the user is actively collaborating. In an
explicitly autonomous periodic task, write after validation and summarize what
was written.

## Race check and cursor advance

Immediately before advancing the cursor, reread `last_digest_at`. If it differs
from `OBSERVED_LAST_DIGEST_AT`, another digest won the race. Leave the draft/file
visible for reconciliation, do not advance the cursor, and report the conflict.

Otherwise:

```sh
memon --project-root . journal digest-mark --at "$INVOCATION_TIME"
```

Advance only after the digest write succeeds. Never move the cursor past the
fixed upper bound or backward.

## Guardrails

- Only this skill updates `last_digest_at`.
- Never include events newer than `INVOCATION_TIME`.
- Never use this workflow for a theme-driven report.
- Never silently repair unknown sections or managed-section conflicts.
- Never edit Experiment files directly; use `memon-write-experiment-doc`.
- Never call the deprecated warning CLI.
- Never archive Runs automatically.
