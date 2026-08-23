## 1. Durable local precedence

- [x] 1.1 Add browser-local dirty/mutation/ack metadata without changing the stored preference JSON shape.
- [x] 1.2 Mark only serialized value-changing setters as dirty, including explicit changes to empty values.
- [x] 1.3 Reconcile dirty local, absent local, clean local, missing server, and stale server responses correctly.
- [x] 1.4 Keep ordered owner writes alive across unmount and clear dirty only for the matching acknowledgement.
- [x] 1.5 Preserve dirty state after failed writes and retry from later mutation or remount.

## 2. Verification and delivery

- [x] 2.1 Add regressions for no-local hydration, explicit empty changes, stale server conflict, failed writes, no-op setters, and unmount queues.
- [x] 2.2 Run focused tests, type checking, formatting checks, strict OpenSpec validation, and a production build.
- [x] 2.3 Deploy one healthy web process on port 3737, archive the change, and commit only this fix.
