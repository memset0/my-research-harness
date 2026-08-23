## Context

The Experiment page is a client component backed by one React Query detail request. A valid Results section passes `exp.documents.results.data` into `ExperimentResultsTable`, whose visibility, ordering, filters, and other preferences are maintained separately. Refetching or reloading the complete page is wider than the requested operation and can disturb unrelated surfaces.

## Goals / Non-Goals

**Goals:**

- Re-read the current file on explicit user action rather than relying on watcher timing.
- Replace only the Results document supplied to the table.
- Make both source recency and snapshot age visible.
- Keep the last good snapshot usable after any refresh failure.

**Non-Goals:**

- Poll `results.yaml` automatically.
- Clean, rewrite, or otherwise mutate unsupported YAML fields.
- Refresh README, Implementation, Investigation, Runs, diagnostics outside Results, or page metadata.
- Reset persisted or temporary Results table preferences.

## Decisions

### 1. Add a narrow snapshot endpoint

`GET /api/experiments/:id/results` resolves the Experiment through the authenticated runtime, reads its managed Results path directly from disk, parses it with Core's canonical `parseResultsYaml`, and returns `{ document, updatedAt, snapshotAt }`. A missing file returns 404; invalid YAML returns 422 with parse diagnostics. The endpoint never writes or cleans the file.

### 2. Include timestamps in the initial detail response

The normal Experiment detail response includes `resultsUpdatedAt` from the Results file's mtime and `resultsSnapshotAt` from response creation. This avoids an immediate duplicate Results request just to initialize the status UI.

### 3. Keep Results refresh state inside its section card

The Results card owns the last good document, timestamps, pending state, and local error. A successful request atomically replaces those values. A failed request leaves them unchanged. Other cards and the outer Experiment query are neither invalidated nor remounted.

### 4. Distinguish source update time from snapshot age

`Last updated` is the server-reported `results.yaml` mtime. `Stale for` is elapsed wall time since the currently displayed snapshot was read. It resets after a successful refresh and advances on a lightweight client timer; it describes potential snapshot staleness without claiming the source changed.

## Risks / Trade-offs

- Snapshot age does not prove that the source changed; it communicates how long the page has gone without checking.
- File mtime is filesystem metadata and may be coarse on some filesystems.
- A read/stat race can associate a very recent mtime with content read immediately before a concurrent write; a later Refresh resolves it.
