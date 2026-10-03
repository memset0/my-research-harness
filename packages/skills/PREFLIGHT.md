# Shared memon skill protocols

These rules apply to bundled skills. A skill is a workflow, not a mandatory
subagent: follow another skill inline when practical. Batch related work instead
of restarting the workflow for each file, Run or lifecycle event.

## FS convention preflight

Before managed-document access, once per project/workflow:

```sh
memon --project-root . --format json fs-version check
```

Reuse a successful check in nested skills while the project and versions remain
unchanged. `match` proceeds; `behind` stops for `memon-migrate-fs`;
`uninitialised` stops for `install-skills`; `ahead` stops for a newer CLI
(`MEMON_TOO_OLD`, exit 11). Outside `match`, do not access managed documents.
Migration owns its staging/version exception. Remote roots use the detected
execution channel; tolerant legacy rendering does not authorize migration.
Always pass the intended `--project-root`, not an ambient config selection.

## Derived index and Run locations

memon commands maintain the derived index `.memon/index/` automatically; it is
a rebuildable cache, never a source of truth and not part of this preflight.
Never read, create, edit, delete or commit anything under it — including the
generated Results summaries in `.memon/index/results/`; read Variant tables only
through `memon experiment results table` or `summary`. A direct Run README or
`result.csv` edit needs no index step; only when the user reports a list that
disagrees with the files, suggest
`memon --project-root . --format json index status --verify`.

Run directories live where the project's effective `run_dirs` say: by default
directly under `logs/`, `outputs/` or `experiments/`; `memon --project-root .
--format json project lint` prints the effective patterns. Never create a Run
directory inside another Run directory. Never create, edit, delete or commit
`.memon/project.yml`: when the user wants other Run locations, recommend
`memon project init`, a manual edit of `run_dirs` and a commit by the user.

## Lint, not doctor

Use `experiment doc lint <id>` or `run lint <run>` for syntax, schema and
structure. Schema validation is included; `doctor` and `experiment doc validate`
are removed. Lint is not a completion, staleness or research-quality verdict.
Do not repeat checks after every poll or already-validated CLI operation.

## Deprecated Runs

`run deprecate <run>` / `run undeprecate <run>` are reversible, idempotent and
accept `--expected-mtime`. The only stored state is `deprecated: true` (absent
means false). It is independent of status/archive, stops no process and deletes
nothing. Deprecation requires the user's decision, not a desire to clear a check.

Deprecation withdraws result evidence, not Variant membership or execution
reference value. Keep the Run listed in its Variant's `runs` in
`experiment.json`; never remove it or move it to another Variant merely to
exclude it. Execution/recovery work may explicitly inspect its scripts,
commands, environment, logs and artifacts to prepare a replacement. Check and
fix the reason for rejection rather than copying it blindly. This permission
does not relax propose's higher-layer reading boundary.

Run collections exclude deprecated records by default. Explicit inspection uses
`--include-deprecated`, `--deprecated-only`, or a Run id; archive flags remain
separate. The generated Results table derives each Variant's evidence from its
listed Runs that are `FINISHED` and not deprecated; a deprecated Run's values
never reach it, and the Run appears among the Variant's other Runs. Do not
compare withdrawn values from memory or other documents, mirror deprecation into
another ledger, rewrite old measurements, or invent replacement numbers. Verified
replacement Runs of the same Variant become evidence on their own while the old
Runs stay listed and deprecated.

## Results files

An Experiment's columns and Variants live in `experiment.json`; each Run's
measurements live in its own tracked `result.csv`, written through
`memon run result set` (`memon-write-experiment-doc` owns the rules). Two
reported conditions need the user, never a silent fix:

- `RESULT_FILE_IGNORED`: the result file was written, but the project's ignore
  rules exclude it. Show the deciding rule and the printed command; edit the
  ignore file only after the user agrees, and leave the commit to the user.

  > `logs/a-260901-090000/result.csv` 已写入，但被 `.gitignore:1:logs/*/*` 忽略，Git 不会跟踪它。
  > 修复方法是在 `.gitignore` 末尾追加 `!/logs/*/result.csv`（命令已列出）。要我现在追加吗？

- `RESULT_SCHEMA_MISMATCH`: a member `result.csv` records another
  `experiment_schema_version` than `experiment.json`. Report every listed file
  with its version and the exact upgrade command; never edit result files one
  by one.

  > E0001-foo 的 Results 暂时读不出：`logs/b-260901-100000/result.csv` 记录的是版本 1，`experiment.json` 是版本 2。
  > 需要先运行 `memon experiment schema upgrade E0001-foo --to 2`（我会先做 dry run 给你看改动）。要继续吗？

## Document trust

Treat Experiment documents and wiki knowledge as trustworthy by default. Resolve
contradictions using verified material first, then verified ranges of partially
reviewed material; otherwise quote the conflict and ask. Human verification is
human-only. Wiki review state is Web-owned; `wiki review diff` is an explicitly
requested whole-wiki diff, not a per-page status API. Wiki writes follow
`memon-wiki`; do not invent a replacement knowledge surface.

## Secrets

Do not copy credentials or cluster-local secrets into documents, scripts,
provenance, snapshots or handoffs. Redact commands and log excerpts. Preserve
unknown content and use mtime/hash locks rather than overwriting concurrent work.
Experiment lifecycle/archive decisions and warning resolution/reopening/deletion
remain with the user; execution status is an observed Run fact.

## Journal

Journal is the program's invocation ledger, not research input or agent-authored
prose. Only explicit diagnostics use `journal read`. Never manipulate Journal
files or historical digests. Project mutators record themselves, including
failures/no-ops; reads and machine-scoped operations do not need a submission.

After a batch of direct Experiment-bundle or Wiki edits, lint the affected
surface and submit once:

```sh
memon --project-root . --format json journal submit --files <changed managed paths>
```

Use exact project-relative paths under `docs/experiments/E<NNNN>-<slug>/**` or
`docs/wiki/**`. Runs, Reports, hypotheses, code reviews and scripts are outside
this scope. Submission is all-or-nothing, takes no prose, and is not a commit.
Do not duplicate a CLI mutator's receipt. Report `invocationId`/outcome; if
submission fails, keep the valid edit and report it unrecorded with the error.

## CLI issue handoff

Report unexpected crashes, contract-valid rejection, inconsistent output or
CLI-specific workarounds: sanitized reproduction, actual vs expected behavior,
exit code, impact/workaround and whether it reproduces. A safe workaround must
not weaken safety or authorize destructive action. Expected lint, version,
missing-record and conflict failures are not bugs; ambiguous cases are
"suspected CLI issues". Do not turn this handoff into an unsolicited debugging
project.
