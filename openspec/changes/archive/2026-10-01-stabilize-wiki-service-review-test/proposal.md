## Why

The archive gate for the v7.1.0 changes failed once with a Vitest "Unhandled Rejection" in `packages/backend/src/wiki-service.test.ts` even though all 234 Backend tests passed; three standalone reruns were clean. The test "leaves review unchecked for a Project with no execution target" creates three rejecting review promises in an array and only attaches a handler to each one when the loop reaches it, so a promise that rejects before its turn is reported as unhandled. A flaky gate blocks archives, so the test must be deterministic.

## What Changes

- Settle the three review operations together (`Promise.allSettled`) before asserting, then assert each one was rejected with `EXECUTION_UNAVAILABLE`. The assertions' intent is unchanged.
- Fix any other place in the same file that builds rejecting promises first and attaches handlers later.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The canonical `test-suite` spec has no requirement about test determinism or unhandled rejections, and product behavior is unchanged, so this change sets `skip_specs: true` rather than inventing a requirement.

## Impact

- `packages/backend/src/wiki-service.test.ts` only (test code).
- No production code, spec, skill, API, on-disk format or release surface change.
