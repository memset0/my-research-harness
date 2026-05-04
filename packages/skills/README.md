# memon skills — index

Six Claude Code skills that compose into the **author → run → observe →
synthesize → propose** loop for an ML experiment project. Bundled and
synced into `<projectRoot>/.claude/skills/` by
`memon install-skills --project-root <path>`.

All skills are zero-runtime-dependency on the memon web stack — they
only call the `memon` CLI with `--project-root <path>` (or `.`) so they
work without a `config.yml`.

## Pick the right skill for the job

| Want to… | Use | Notes |
|---|---|---|
| Author a launcher script (`run.sh`, sweep wrapper, …) | `memon-write-script` | User-invoked. Stable script in `scripts/<area>/`; each run gets a fresh dir. |
| Run an existing script + drive it through terminal state | `memon-run-experiment` | User-invoked. Owns the README's full content (frontmatter + body). |
| Drop a one-line observation / request / error in JOURNAL | `memon-append-journal` | **Model-invocable.** Cheap, single-event append. |
| Daily integrity sweep + cursor-advancing digest | `memon-digest-journal` | User-invoked. Folds in the old `doctor` checks. |
| Theme-driven, cursor-independent narrative report | `memon-write-report` | User-invoked. `R<NNNN>-<slug>.md` with re-runnable selector. |
| "What should I run next?" — brainstorm + converge | `memon-propose` | User-invoked. Read-only research collaborator. |

## Invocation policy

- **`disable-model-invocation: true`** — skill is user-invoked only
  (slash-command or explicit handoff). All "heavy" skills that write to
  disk in non-trivial ways carry this flag: `memon-write-script`,
  `memon-write-report`, `memon-run-experiment`, `memon-digest-journal`,
  `memon-propose`.
- **`disable-model-invocation` absent / false** — model may invoke
  autonomously. Reserved for low-stakes, single-event actions:
  `memon-append-journal`. The model can drop a NOTE without asking.

The intent: heavy work needs a human in the loop; "I noticed something
worth recording" can fire on its own.

## Cross-skill handoffs

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
| `memon-write-script` | a `.sh` file under `scripts/` | run dirs, READMEs, JOURNAL frontmatter |
| `memon-run-experiment` | `<run-dir>/README.md`, `code.diff`, `code.head` | scripts, digests, reports, JOURNAL frontmatter |
| `memon-append-journal` | one event line in `JOURNAL.md` body | JOURNAL frontmatter, READMEs |
| `memon-digest-journal` | `docs/digests/D<NNNN>-<YYYY-MM-DD>.md`, `last_digest_at` cursor; may write READMEs *during* doctor fixes | reports |
| `memon-write-report` | `docs/reports/R<NNNN>-<slug>.md` | digests, READMEs, JOURNAL cursor |
| `memon-propose` | nothing — read-only | everything |

## Versioning

`metadata.version` in each skill's frontmatter is informational
(per-skill, hand-bumped on substantive change). Not yet used by any
tooling. Keep loosely in sync but don't sweat exact alignment.
