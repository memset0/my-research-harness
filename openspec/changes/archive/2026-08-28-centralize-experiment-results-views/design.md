## Context

One Results table currently calls `useUserPreferenceState` with a legacy key of the form `memon:results-table:<project identity>:<experiment>:preferences`. Owners reconcile that browser record with `user_preferences(username, preference_key, ...)` in `memon-ui-preferences.sqlite3`; viewers are browser-only. The production central database currently contains live Results arrangements that must survive this refactor.

The desired resource is not a general user preference or Project template. It is one of multiple named ways to view one Experiment's Results table. All users of that Experiment share the same collection, while a share link grants read-only access only inside its exact Host and Project scope.

## Goals / Non-Goals

**Goals:**

- Make View ownership exactly Experiment-scoped and independent of username.
- Preserve every distinct legacy Results arrangement and keep a recoverable source record.
- Let viewers read and switch among all Views in their shared Experiment without gaining write access.
- Preserve immediate local owner interactions, ordered asynchronous writes, durable dirty retry, and causal protection against stale hydration.

**Non-Goals:**

- Make the selected View global across users; selection remains a per-browser navigation choice.
- Turn Project-wide starred column labels into Experiment View data.
- Store Views on cluster Backends or in `results.yaml`.
- Add real-time collaborative merging; complete View snapshots remain last-writer-wins as before.

## Decisions

### One central table owns Experiment Views

SQLite gains `experiment_result_views`. Each row contains an opaque View ID, exact `host`, `project`, and `experiment_id`, a bounded name, the complete normalized Results preference JSON, a monotonic revision, and timestamps. Standalone mode uses an empty host discriminator only for compatibility; in central mode a non-empty configured Host is required. No username column participates in identity, uniqueness, reads, or writes.

The collection is ordered by creation time and ID. Names are unique within one Experiment after trimmed, case-insensitive comparison so the selector stays unambiguous. One Experiment may have zero Views only before first creation or after the owner explicitly deletes the last View; the client presents defaults in that state without silently creating data for a viewer.

### View definition contains Experiment-local Results state

The View definition is the existing complete Results preference object: hidden columns (the inverse of the checked column controls), column order, maximum lines, default sort chain, pinned columns, row filters, row overrides, SOTA display modes, and decimal places. Temporary show-all and temporary header sort remain mounted-only. Project-wide starred column labels retain the generic preference path because they are deliberately shared across Experiments and are not part of a View.

### Central API separates readable collection from owner mutations

`GET /api/experiment-results-views?host=&project=&experiment=` is a project-scoped central read route. Middleware and the handler both require exact Host+Project viewer scope in central mode. It returns every View for that Experiment. `POST` creates a View, while `PATCH` and `DELETE` on `/api/experiment-results-views/<id>` mutate only after matching the supplied exact Experiment scope. All mutations require the owner role.

Handlers validate selectors, names, IDs, JSON size, and definition shape boundaries. Responses are authenticated `no-store`. The route never proxies to a Backend and stores no cluster paths or credentials.

### Existing synchronization semantics move from preference key to View ID

The client hydrates the collection, chooses a locally remembered active View when it still exists (otherwise the first View), and renders the server definition. Owner edits update React state and browser storage immediately, mark the exact View mutation dirty, and enqueue complete-snapshot writes serially per View. A stale GET or acknowledgement cannot overwrite a causally newer dirty local mutation. Failed writes retain the dirty local snapshot for retry. Refresh/remount remains the cross-browser convergence point and concurrent devices remain last-writer-wins.

View create, rename, and delete are explicit lifecycle operations. Viewers receive the same collection and may change their local active selection, but every editing control and lifecycle mutation is disabled; no viewer-local fork is presented as a shared View.

### Migration is additive, transactional, deterministic, and idempotent

On store initialization, a transaction scans only legacy keys matching the Results preference grammar. It parses the username-keyed JSON, derives exact Host/Project/Experiment scope from the key, and groups rows by Experiment. Canonically identical definitions are deduplicated; every distinct definition becomes a View. The first imported definition is named `Default`, with deterministic `Imported view N` names for additional distinct definitions. IDs are deterministic hashes of the legacy source identity so restart/retry cannot duplicate rows.

Legacy `user_preferences` rows are not removed. A migration ledger records completion, and tests verify source row count/content and imported canonical definitions. Before production deployment the SQLite database and WAL state are backed up consistently; after startup, source and destination counts and canonical payloads are checked.

Legacy browser storage covers a different failure mode: if the owner has a legacy Results value but the server returns no Views for that Experiment, the client creates one `Default` View from that exact value and only marks the browser migration complete after acknowledgement. A viewer never performs this import.

## Risks / Trade-offs

- [Two owners edit one View concurrently] Complete snapshots remain last-writer-wins, matching the established rule; revisions and timestamps make the result observable but do not introduce field merging.
- [Legacy key parsing is ambiguous] Host and Project grammars exclude `:`, and Experiment identifiers are the final segment, so two segments map to standalone and three to central. Malformed keys remain untouched and are recorded as skipped rather than guessed.
- [Viewer bypasses disabled controls] Middleware and route handlers independently reject mutations; UI disabling is not the security boundary.
- [Migration bug loses arrangements] Import is additive, transactionally idempotent, retains source rows, uses deterministic IDs, and is verified against canonical payloads before considering rollout complete.
- [A deleted or renamed Experiment leaves Views] Rows remain bound to the stable Experiment ID. Garbage collection is intentionally deferred so a temporary filesystem disappearance cannot delete curated state.

## Migration Plan

1. Add schema, deterministic legacy importer, View API, authorization, and focused store/route tests.
2. Refactor the Results client to the shared View hook and add owner/viewer lifecycle and synchronization regressions.
3. Back up the live SQLite database consistently and record the legacy Results row inventory and canonical payload hashes.
4. Deploy the central-only release, allow the idempotent transaction to import existing rows, and verify every source payload exists in the destination under the correct Experiment.
5. Smoke-test owner edits, multiple Views, refresh convergence, and exact-scope share read-only behavior.
6. Roll back application code if needed while retaining both additive View rows and untouched legacy rows; restore the SQLite backup only if the database itself is damaged.
