## 1. Shared Preference Hook

- [x] 1.1 Support functional preference setters resolved against the latest synchronous value.
- [x] 1.2 Preserve user changes made during a delayed found/missing SQLite hydration response and enqueue the latest value.
- [x] 1.3 Retain server-authoritative hydration when no user interaction occurs and retain explicit-empty versus missing-row behavior.

## 2. Results Preference Mutations

- [x] 2.1 Normalize and merge Results preference patches inside functional setters.
- [x] 2.2 Make checkbox, filter, override, pin, order, line-count, and default-sort operations compose without stale render snapshots.
- [x] 2.3 Preserve preferences when a manually refreshed Results document changes its available columns or rows.

## 3. Verification and Delivery

- [x] 3.1 Add hook regressions for delayed found/missing hydration and batched functional updates.
- [x] 3.2 Add Results regressions for rapid multi-checkbox and filter/checkbox updates plus remount restoration.
- [x] 3.3 Run focused tests, type checking, formatting checks, strict OpenSpec validation, and a production build.
- [x] 3.4 Deploy the verified build to port 3737 without touching concurrent agent changes.
- [x] 3.5 Archive into the canonical specification and commit only this fix.
