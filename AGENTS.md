# Agent workflow rules

These rules supplement `CLAUDE.md` and take precedence over conflicting deployment or unit-test scheduling guidance there.

## Development and archive testing

- During development, choose a small, change-relevant, cherry-picked testlist yourself. Run those test files or cases rather than the full unit-test suite. Cover affected behavior and plausible regressions; report the selected list and actual results.
- Do not run the full unit-test suite routinely during development, release, or deployment.
- Once implementation is complete and the user confirms it is ready to archive, run the full unit-test suite locally before archiving. If it fails, interrupt the archive workflow, report the failures, and resolve them before proceeding; do not archive a failing change.
- If the user explicitly asks to archive directly, the pre-archive full unit-test suite may be skipped. State that it was skipped; never claim an unexecuted suite passed.
- Never run unit tests on remote clusters. Remote deployment is limited to installation, necessary builds, startup, and lightweight service-readiness checks.

## Local deployment

- Use direct production build + hosting on the local machine. Do not create or use systemd services for local memon deployment.
- Reuse an already completed build of the exact release when available; do not rebuild or repeat tests merely to deploy it.
- Start the production host directly, keep it running after the agent session, and check service readiness. Stop the old host before replacing its build output.
- An explicit user instruction to deploy immediately without further tests skips additional test runs; it does not turn unexecuted tests into passing results.
