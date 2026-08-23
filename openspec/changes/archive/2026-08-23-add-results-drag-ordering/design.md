## Context

The Results table already stores one preference document in browser storage and, for owners, in the SQLite-backed UI preference endpoint. Column controls render in source order, headers render in pin-group order, row filters are an ordered array with AND semantics, and default-sort rules are an ordered comparator chain.

## Goals / Non-Goals

**Goals:**

- Provide direct drag ordering on both column surfaces and on existing filter/sort badges.
- Use a single persisted column-order vector so checkbox and table reorder actions cannot diverge.
- Keep new or renamed document columns recoverable when an older preference is restored.
- Retain the current pin-left/unpinned/pin-right placement contract.

**Non-Goals:**

- Write UI preferences into `results.yaml`.
- Change row-filter composition from AND to an order-sensitive boolean expression language.
- Change pin side merely because a column is dragged.
- Add a new persistence endpoint or database table.

## Decisions

### 1. Persist stable IDs and append newly discovered columns

Preferences gain `columnOrderIds`. Restoration removes unknown/duplicate IDs and appends every current column not present in the saved vector using document/built-in order. An empty or absent vector therefore preserves the existing default.

### 2. Both column drag surfaces write the same order

The checkbox item and table header carry the same stable column ID. Dropping either one relative to another rewrites `columnOrderIds`; controls consume that vector directly, and table rendering partitions it into pinned-left, unpinned, and pinned-right groups. Pinning remains an orthogonal placement constraint.

### 3. Arrays remain the source of rule priority

Dragging a row filter rewrites the existing `rowFilters` array. Because filters combine with AND, this changes visible priority and short-circuit evaluation order without changing the mathematical row set. Dragging a default-sort badge rewrites `defaultSortRules`, which changes comparator priority and can change final row order.

### 4. Use native drag events with existing controls

Existing shadcn-styled controls remain the visual primitives. Native drag events add grab/drop behavior and restrained ring/opacity states without introducing a separate component system. Existing sort editor Earlier/Later actions remain a non-drag fallback.

### 5. Sticky pin accents must be opaque

Unpinned metric and starred cells retain translucent accents. Once pinning becomes sticky, the header and every body cell switch to an opaque surface-specific accent (`sky` for metrics, `amber` for starred columns, and the normal muted/background surface otherwise). Starred emphasis retains precedence over metric emphasis. When the pinned-width fallback disables sticky positioning, the normal translucent treatment resumes.
