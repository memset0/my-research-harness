## 1. Resolution compatibility

- [x] 1.1 Confirm only generic resolution I/O failures with metadata and return ENOENT only for confirmed absence; verify existing-agent client integration tests for missing, recreated, present and failed-confirmation cases.
- [x] 1.2 Verify the Store observes missing remote paths without masking authorization or source errors; run the focused client and Store integration tests, typecheck and strict OpenSpec validation.

## 2. Deployment verification

- [x] 2.1 Validate experiment list, document and Results reads through an isolated agent-backed website configuration; retain deployment-specific evidence only in ignored local records.
