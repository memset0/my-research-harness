# Shared conventions

Use `memon --project-root <project>` explicitly; consult `--help` when needed.
The first `experiment create` initializes a fresh research project. Existing
research is never initialized or migrated implicitly. Read `.memon/version.json`
when compatibility matters; upgrade an incompatible CLI or use `memon-migrate-fs`
for an authorized conversion. Creation, reads and refresh report format errors.

Edit Markdown, JSON and CSV directly when convenient, then publish the change as
described under Published index. Commit research records and CSVs.

Record ISO8601 times with the writer's local offset; preserve historical times,
never infer them from checkout mtimes. Respect mtime/hash conflicts by rereading.
Keep secrets outside research files. Use polling, not filesystem watchers.
Report failed commands and any incomplete publication; do not fabricate results
or add a manual journal entry for every action. Follow project Git rules.

Hypotheses is retired. Preserve historical files; agree any migration per project.

## Published index

The website lists and opens Experiments, Wiki pages and Reports only through the
catalogs that `memon refresh` publishes in `.memon/index/` at the project source.
CLI lifecycle writes (`experiment create`, `run create/update`, `wiki create`)
publish automatically; files you create, edit, move or delete directly do not.

1. After direct Experiment, Wiki or Report file changes, run
   `memon --project-root <project> refresh` on the host that owns the project
   files, not on the dashboard host. When an Experiment's results or Run records
   changed, also run `refresh E0001 [E0002…]`; that targeted form recomputes
   those Experiments only and does not republish Wiki or Report catalogs.
2. A successful refresh is enough; no separate verification is required. When
   unsure whether the index is current, `refresh --check` compares it with the
   files without writing.
3. A refused refresh publishes nothing and lists every document it cannot
   index. Fix all of them, rerun, and report any you cannot fix. A published
   refresh can still exit 1 for content diagnostics; report those too.
4. `.memon/index/` is derived and ignored by Git. Never commit or hand-edit it;
   `refresh` rebuilds it from the files. A website page that says "Not refreshed"
   means the file exists but step 1 was skipped.
