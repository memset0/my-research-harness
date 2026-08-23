## Context

The Results table stores one JSON preference value locally and, for owners, in SQLite. The hook starts a server GET after mount. The current server-found branch is always authoritative, even when the user changed state after that GET began. The table also passes only complete values to the hook and reconstructs them from values captured during render.

## Goals / Non-Goals

**Goals:**

- Never lose an interaction to an older in-flight hydration response.
- Compose multiple synchronous or React-batched preference changes.
- Preserve the prior distinction between a missing SQLite row and an explicitly saved empty preference.
- Keep browser UI updates and server writes parallel from the user's perspective.

**Non-Goals:**

- Merge edits made concurrently in two different browser tabs or devices.
- Change owner/viewer authorization or the SQLite schema.
- Store preferences in `results.yaml`.

## Decisions

### 1. Functional updates resolve against a synchronous ref

`useUserPreferenceState` exposes a React-style value-or-updater setter. Each call resolves against `valueRef.current`, updates that ref immediately, then updates React state, localStorage, and the ordered server-write queue. Two calls in one task therefore observe one another even before React re-renders.

### 2. Interaction after hydration starts is causally newer

The server row remains authoritative when no interaction occurs during the GET. If any local setter runs while hydration is pending, the eventual response is older than that user action regardless of whether the row exists. The hook keeps the latest local value and enqueues it to SQLite after enabling server persistence.

### 3. Results mutations normalize and merge inside the setter

The table converts stored JSON into a valid current preference object inside every functional update, then applies the requested mutation. Field patches cannot erase other fields changed earlier in the same batch, and same-field operations such as hiding two columns compose against the latest hidden set.

## Risks / Trade-offs

- A user action made during hydration intentionally overwrites a server value that may have been written by another device milliseconds earlier; this follows direct-interaction precedence on the active page.
- Cross-tab synchronization remains last-writer-wins through SQLite on the next mount.
