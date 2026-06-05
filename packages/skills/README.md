# memon skills — index

Ten agent skills that compose into the **author → run → observe →
synthesize → propose** loop for an ML experiment project (plus
`memon-notify`, an out-of-band push to the user, and `memon-migrate-fs`,
the schema-migration entry-point). Bundled and
synced into `<projectRoot>/.claude/skills/`, `.codex/skills/`, and
`.opencode/skills/` by `memon install-skills --project-root <path>`
(opt out of any agent dir with `--agent claude` / `--agent claude,opencode`
/ etc).

All skills are zero-runtime-dependency on the memon web stack — they
only call the `memon` CLI with `--project-root <path>` (or `.`) so they
work without a `config.yml`. The sole exception is `memon-notify`,
which has no project context: it reads Telegram credentials from a
`config.yml` `telegram:` block (or env vars) via `--config`, not
`--project-root`.

## Pick the right skill for the job

| Want to… | Use | Notes |
|---|---|---|
| Drive one experiment end-to-end via conversation (design → write-script → run-experiment → maintain exp doc) | `memon-drive` | Long-running orchestrator. Calls write-script / run-experiment as sub-tools. Primary canvas: exp doc's `## Plan`. |
| Author a launcher script (`run.sh`, sweep wrapper, …) | `memon-write-script` | Stable script in `scripts/<area>/` (cross-exp) or `docs/experiments/E<id>-<slug>/` (per-exp scratch); each run gets a fresh dir. |
| Run an existing script + drive it through terminal state | `memon-run-experiment` | Owns the README's full content (frontmatter + body). |
| Drop a one-line observation / request / error in JOURNAL | `memon-append-journal` | Cheap, single-event append. |
| Flag one anomaly on an existing run for human adjudication | `memon-append-warning` | Single OPEN row in the README's `## Warnings` table. NEVER resolves / reopens / deletes. |
| Daily integrity sweep + cursor-advancing digest | `memon-digest-journal` | Folds in the old `doctor` checks. |
| Theme-driven, cursor-independent narrative report | `memon-write-report` | `R<NNNN>-<slug>.md` with re-runnable selector. |
| Leave a human a guided review of one session's worth of code | `memon-write-code-review` | `docs/code-review/<date>-<slug>.md` (project-wide) or an experiment's `code-review/`. Frontmatter lists the reviewed commits (per-repo GitHub links) + a review checklist; the dashboard tracks per-commit / per-item progress. |
| "What should I run next?" — brainstorm + converge | `memon-propose` | Read-only research collaborator. |
| Ping the user on Telegram when an autonomous run needs attention | `memon-notify` | One event = one notification. Send-only (push, no reply). Uses `--config`, not `--project-root`. |
| Migrate a project's on-disk layout to a newer FS convention version | `memon-migrate-fs` | **User-invoked only** (sole skill with `disable-model-invocation`). Only skill that bumps `.memon/version.json`. Exempt from the FS-version preflight. |

## Invocation policy

- **`disable-model-invocation: true`** — skill is user-invoked only
  (slash-command or explicit handoff). Reserved for the schema migration
  entry-point, which cascades writes across multiple files in lockstep
  and creates git commits as part of normal operation — an autonomous
  invocation would be expensive to unwind. The sole member is
  `memon-migrate-fs`.
- **`disable-model-invocation` absent / false** — model may invoke
  autonomously. All other 7 bundled skills (`memon-write-script`,
  `memon-run-experiment`, `memon-digest-journal`, `memon-write-report`,
  `memon-propose`, `memon-append-journal`, `memon-append-warning`) sit
  here. Their internal flows already carry the safety mechanism:
  user-facing Chinese prompts before non-trivial writes, mtime-locked
  conflict handling, recovery loops with explicit user surface points.

The intent: only the schema migration entry-point needs a gate at the
invocation layer. The other skills' built-in user-confirmation flows
are the safety mechanism — the frontmatter flag would be redundant
and would defeat the `memon-drive` orchestrator's ability to call
them as sub-tools.

## Cross-skill handoffs

`memon-drive` (the orchestrator skill) sits **above** this pipeline.
It owns the conversation with the user and the exp doc's `## Plan`,
and fires `memon-write-script` / `memon-run-experiment` on demand as
it iterates through Plan items. The diagram below shows the
per-action handoffs; in a `memon-drive` session, those handoffs are
invoked by the orchestrator rather than typed by the user.

```
                ┌─────────────────────┐
   user prompt  │  memon-propose      │ ← read-only; outputs
                │  (brainstorm)       │   proposals user picks from
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │  memon-write-script │ ← if no script yet
                │                     │
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │ memon-run-experiment│ ← launch + lifecycle
                │                     │   (writes README,
                │                     │    handles FAILED,
                │                     │    recovery loop)
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │ (auto, agent-fired) │
                │ memon-append-journal│ ← record observations
                │                     │   during the run
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │ memon-digest-journal│ ← daily sweep + digest
                │                     │
                └──────────┬──────────┘
                           │
                ┌──────────▼──────────┐
                │  memon-write-report │ ← optional theme writeup
                │                     │   (off the digest cadence)
                └─────────────────────┘
```

## Conventions baked into all skills

- **All `memon ...` calls take `--project-root <path>` (or `.`)
  explicitly** — never rely on implicit-cwd fallback. Forces every
  skill to be cwd-portable.
- **Preflight protocol** lives in `PREFLIGHT.md` (same dir). All
  spec-mutating skills point to it instead of duplicating the branch
  table.
- **mtime optimistic locking** for any README write. After a successful
  write, capture the response's new `mtime` and use it as the next
  call's `--expected-mtime`. Exit 9 = `CONFLICT`.
- **Skill files are English; conversational dialogue with the user is
  Chinese.** Embedded Chinese snippets in skill bodies show what to
  *say* to the user; the surrounding documentation stays English.
- **Status enum (uppercase)**: `PENDING` / `RUNNING` / `FINISHED` /
  `FAILED` / `UNKNOWN`. Hypothesis status: `CONFIRMED` / `REFUTED` /
  `PARTIAL` / `OPEN` / `DEFERRED`.
- **No fs watchers**, anywhere — polling only. (Cluster fs has hard
  inotify limits.)
- **All timestamps ISO8601 with timezone offset.**

## Files written / never written, by skill

| skill | writes | never touches |
|---|---|---|
| `memon-drive` | exp doc body sections (Motivation / Method / Plan / Conclusion / Caveats) via `memon experiment readme write` | run READMEs (sub-skills own those), scripts (write-script owns), digests, reports, JOURNAL cursor, warning state changes |
| `memon-write-script` | a `.sh` file under `scripts/` | run dirs, READMEs, JOURNAL frontmatter |
| `memon-run-experiment` | `<run-dir>/README.md`, `code.diff`, `code.head` | scripts, digests, reports, JOURNAL frontmatter |
| `memon-append-journal` | one event line in `docs/journal.md` body | JOURNAL frontmatter, READMEs |
| `memon-append-warning` | one OPEN row in `<run>/README.md` `## Warnings`; one `[WARNING]` event in `docs/journal.md` body | other README sections, JOURNAL frontmatter; never calls `warning resolve|reopen|delete` |
| `memon-digest-journal` | `docs/digests/D<NNNN>-<YYYY-MM-DD>.md`, `last_digest_at` cursor; may write READMEs *during* doctor fixes | reports |
| `memon-write-report` | `docs/reports/R<NNNN>-<slug>.md` | digests, READMEs, JOURNAL cursor |
| `memon-write-code-review` | `docs/code-review/<date>-<slug>.md` or `docs/experiments/E<id>-<slug>/code-review/<date>-<slug>.md` | run/exp READMEs, scripts, reports, digests, JOURNAL; never flips a `reviewed`/`done` the human already checked |
| `memon-propose` | nothing — read-only | everything |

## Versioning

`metadata.version` in each skill's frontmatter is informational
(per-skill, hand-bumped on substantive change). Not yet used by any
tooling. Keep loosely in sync but don't sweat exact alignment.
