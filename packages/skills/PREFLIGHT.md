# Shared conventions

Use `memon --project-root <project>` explicitly. Initialize new projects with
`project init`; consult `--help` or `fs-version check` when needed. Upgrade an
incompatible CLI; migrate older data only within the requested scope.

Edit Markdown, JSON and CSV directly when convenient. After editing experiment
files, `refresh E0001 [E0002…]` publishes results and records. Plain `refresh`
rebuilds only the inventory (e.g. after Wiki edits). CLI Run writes publish automatically.
`.memon/index/` is disposable and untracked; commit research records and CSVs.

Record ISO8601 times with the writer's local offset; preserve historical times,
never infer them from checkout mtimes. Respect mtime/hash conflicts by rereading.
Keep secrets outside research files. Use polling, not filesystem watchers.
Report failed commands and any incomplete publication; do not fabricate results
or add a manual journal entry for every action. Follow project Git rules.
