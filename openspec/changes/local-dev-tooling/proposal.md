## Why

Rendered-page checks were rebuilt by hand in each session, and the machine-local `LOCAL.md` notebook was described only as a deployment record, so local development facts (dev config location, shell and permission quirks, verification commands) had no agreed home.

## What Changes

- Add `scripts/verify-page.mjs`: a headless Chrome check over the DevTools protocol that waits for a selector, runs `--eval`, `--click`, `--reload` and `--screenshot` steps, and reports the document status, failed requests and page exceptions. It exits 1 on a missing selector, a 5xx, a network failure or an exception.
- AGENTS.md §1.1: `LOCAL.md` is the never-committed notebook for this machine's deployment and development details, read at the start of every development, test, release or deploy session.
- AGENTS.md §4.3 gains the scripted rendered check as step 6. The `.gitignore` comment points to AGENTS.md.

## Capabilities

### New Capabilities

### Modified Capabilities

None: repository tooling and agent instructions only (`skip_specs`).

## Impact

`scripts/verify-page.mjs`, `AGENTS.md`, `.gitignore`. No distributed artifact or central change, so no release.
