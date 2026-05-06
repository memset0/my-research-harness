---
name: memon-append-journal
description: Manual + thin wrapper for the `memon journal append` CLI — append a single event to a project's docs/journal.md (NOTE / REQUEST / ERROR). Use when an agent wants to record an observation or open a question. For periodic organization / cleanup, use `memon-digest-journal` instead.
argument-hint: <event tag and body, optionally with experiment id>
license: MIT
metadata:
  author: memset0
  version: "0.2.0"
---

# memon-append-journal

This skill is a manual for the `memon journal append` CLI subcommand —
how to invoke it correctly to add a single event line to
`<projectRoot>/docs/journal.md`. Never modifies the file's frontmatter; only
`memon-digest-journal` is allowed to do that.

For organizing the journal (consolidating events, advancing
`last_digest_at`, integrity sweep), use **`memon-digest-journal`**, not
this one. This skill is just for "append one event right now".

## Preflight — FS convention version

Before doing anything else, confirm the project root's on-disk schema
matches what this skill expects. Run:

```sh
memon fs-version check --project-root . --format json
```

Branch on the `status` field:

- `match` → proceed with the rest of the skill.
- `behind` → STOP. Tell the user: "Project FS convention is at v<current>;
  current memon expects v<available>. Please run the `memon-migrate-fs`
  skill to upgrade before continuing." Do NOT read or write any spec file
  (`README.md`, `docs/hypotheses.md`, `docs/journal.md`, `docs/digests/*`,
  `docs/reports/*`).
- `uninitialised` → STOP. Tell the user: "This project root has not had
  memon installed yet. Run `memon install-skills --project-root .` first."
  Do NOT read or write any spec file.
- `ahead` → the CLI already exited 11 (`MEMON_TOO_OLD`). Forward the
  error: "Project FS convention is at v<current>; this memon supports up
  to v<available>. Upgrade memon to a release that supports v<current> or
  later." Do NOT proceed.

(`memon-migrate-fs` itself is exempt from this preflight; it IS the
migration runtime and reads `.memon/version.json` directly.)

## When to use

- You observed something cross-cutting that doesn't belong in any single
  experiment's README ("memory leaks above 32B context length on this box")
- You want to **request** something from the human user when they next
  check in ("please verify H0007 is still aligned with the new SLURM quotas")
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
| `CREATE` | recorded automatically when an experiment dir first appears — don't emit manually |

`STATUS` is **rejected** by `memon journal append` (CLI returns
`BAD_REQUEST`, exit code 2). Use `memon experiment status set` instead.

## Workflow

1. **Always pass `--project-root .` explicitly.** Project convention —
   never rely on the CLI's implicit-cwd fallback. (Pass an absolute
   path or `.`; never omit the flag.)
2. Pick the tag (default `NOTE` unless the user said otherwise).
3. (Optional) include `--experiment-id <id>` to associate the event with a
   specific run.
4. Run the CLI:

```sh
memon journal append \
  --project-root . \
  --tag NOTE \
  --experiment-id "foo-260504-141512" \
  --body "8B fp16 sweep converged faster than the bf16 reference; possible Adam-state cancellation effect"
```

Output (JSON to stdout):

```json
{ "ok": true, "appended": 1, "timestamp": "2026-05-04T14:18:00+08:00", "path": "/abs/docs/journal.md" }
```

## Composing the body

- One sentence, declarative, no leading "I think" / "we should"
- For a REQUEST, end with a question mark or a clear ask
- If the observation is about a specific experiment, **always** pass
  `--experiment-id` — it lets the journal view filter cleanly later
- Don't paste log excerpts (use the experiment's `## Caveats` section for those)

### Tone — only when **you (the agent) are composing the body**

If the user dictated the body verbatim (`--body "<their words>"`), pass
it through as-is. The conventions below only apply when YOU choose the
wording:

- **NOTE** — declarative, past tense; what was observed.
  - ✅ "8B fp16 sweep converged 1.3× faster than the bf16 reference."
  - ❌ "I think bf16 might be slower somehow"
- **REQUEST** — forward-looking, ends with an explicit ask.
  - ✅ "Please verify H0007 still aligns with the new SLURM quotas."
  - ❌ "H0007 quota thing"
- **ERROR** — names the failure cleanly, mentions the host/run if scoped.
  - ✅ "Wandb auth missing on host gpu-04; runs there bypass tracking."
  - ❌ "Something's wrong with wandb"

## Errors

| exit | meaning |
|---|---|
| 0 | appended |
| 2 | BAD_REQUEST (e.g., empty body, `--tag STATUS`, unknown tag) |
| 1 | other failure (fs error, etc.) |
