# Report to Wiki conversion

Use this optional semantic conversion only for selected legacy Reports. It does
not change the filesystem version or convert unrelated pages. Set `MEMON_SOURCE`
to the installed checkout and `PROJECT_ROOT` to the selected research project.

Preview one Report:

```sh
node "$MEMON_SOURCE/packages/core/migrations/scripts/reports-to-wiki.mjs" \
  --project-root "$PROJECT_ROOT" --report R0001 --kind note
```

Inspect the destination, source hash and diagnostics. Retain historical creation
time with its numeric offset. If it is absent or invalid, supply `--created-at`
from actual evidence; do not use checkout mtimes. Select the page kind/status
according to the content. The preview writes no files.

Apply within the requested scope, passing the preview's `sourceHash`:

```sh
node "$MEMON_SOURCE/packages/core/migrations/scripts/reports-to-wiki.mjs" \
  --project-root "$PROJECT_ROOT" --report R0001 --kind note \
  --expected-hash '<sourceHash>' --apply
memon --project-root "$PROJECT_ROOT" show W0001
```

Use the returned W ID in the final command. The script allocates the ID under
the shared writer lock, preserves custom metadata and bundle assets, validates
the new page, retains the original under `.memon/migrations/reports-to-wiki/`,
and leaves a relative old-path alias for existing links. `legacy_id` preserves
R-ID references. A stale source or escaping symlink stops conversion.

Verify body, metadata, asset hashes and both old/new links, then review only the
selected changes under the project's Git rules. Keep the recovery directory
untracked. In Git mode, retain its preimages for untracked assets as well.

If conversion fails before completion, the script restores the original path
and removes only its own new target. If inventory publication alone fails, the
conversion remains applied: run `memon --project-root "$PROJECT_ROOT" refresh`.
For a later rollback, stop writers, read the returned backup's `manifest.json`,
verify that the alias and target still match this conversion, remove that alias,
and restore `backup/source` to the original Report path. Preserve subsequent Wiki
edits separately before removing the converted target. Never restore over
concurrent work or assume that a failed invocation made no changes.
