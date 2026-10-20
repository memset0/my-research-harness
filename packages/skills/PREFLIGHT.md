# Shared conventions

Use `memon --project-root <project>` explicitly. Check `fs-version check` once
per task: upgrade an older CLI; migrate older data only within the requested
scope. FS9/FS10 experiments remain readable. Initialize new projects with
`project init`; consult command `--help` as needed.

CLI writes publish the inventory. After direct research-file edits, rebuild
changed experiment results and run `index rebuild` once for the batch.
`.memon/index/` is disposable and untracked; commit research records and CSVs.

Record ISO8601 times with the writer's local offset; preserve historical times,
never infer them from checkout mtimes. Respect mtime/hash conflicts by rereading.
Keep secrets outside research files. Use polling, not filesystem watchers.
Report failed commands and any incomplete publication; do not fabricate results
or add a manual journal entry for every action. Follow project Git rules.
