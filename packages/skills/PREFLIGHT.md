# Shared conventions

Use `memon --project-root <project>` explicitly; consult `--help` when needed.
The first `experiment create` initializes a fresh research project. Existing
research is never initialized or migrated implicitly. Read `.memon/version.json`
when compatibility matters; upgrade an incompatible CLI or use `memon-migrate-fs`
for an authorized conversion. Creation, reads and refresh report format errors.

Edit Markdown, JSON and CSV directly when convenient. After editing experiment
files, `refresh E0001 [E0002…]` publishes results and records. Plain `refresh`
rebuilds only the inventory (e.g. after Wiki edits). CLI Run writes publish automatically.
`.memon/index/` is disposable and untracked; commit research records and CSVs.

Record ISO8601 times with the writer's local offset; preserve historical times,
never infer them from checkout mtimes. Respect mtime/hash conflicts by rereading.
Keep secrets outside research files. Use polling, not filesystem watchers.
Report failed commands and any incomplete publication; do not fabricate results
or add a manual journal entry for every action. Follow project Git rules.
