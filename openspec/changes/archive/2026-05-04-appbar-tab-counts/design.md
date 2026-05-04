## Context

The AppBar tabs are rendered in `apps/web/components/app-bar.tsx`. Today
each tab is a simple `<Button>` wrapping a `<Link>` with the label as
text. The AppBar is a client component that uses `usePathname()` to
decide active state.

Counts for each kind are already derivable from the existing API
responses:
- experiments: `GET /api/experiments?project=X` → `experiments.length`
- hypotheses: `GET /api/hypotheses?project=X` → `entries.length`
- journal: `GET /api/journal?project=X` (no limit override) — total
  events; need to verify the route doesn't pre-trim. If it does we
  may need a `?countOnly=1` short-circuit.
- reports / digests (post-inbox-reports-and-digests): both list APIs
  return arrays, length is the count.

React Query already caches all five list responses (the hypothesis,
journal, and experiment views fetch them directly). If the AppBar
queries with the **same query keys** as the views, no extra network
trips happen — the AppBar simply observes the cache.

Warning indicators are explicitly out of scope (user is designing a
proper warnings system later). The design must reserve markup space
for them so the future change is a "fill the slot" rather than
"redo the layout" diff.

## Goals / Non-Goals

**Goals:**

- Live numeric badge per tab using existing data sources.
- Reuse React Query keys already in the app to avoid duplicate fetches.
- Reserve a small slot next to each badge for a future warnings
  indicator (no behavior in this change).
- No flash of `0` while loading; render a skeleton pulse instead.

**Non-Goals:**

- Implementing warnings. Just the slot.
- Adding a new API endpoint. All counts come from existing list
  endpoints.
- Changing how the views themselves render. The AppBar reads the
  same cache the view writes to.
- Counts on the sidebar.

## Decisions

### D1. Reuse the views' React Query keys, no new endpoint

Each tab's badge mounts the same `useQuery` the corresponding view
already mounts. React Query dedupes — first to mount wins, subsequent
mounts get the cached value. Keys are the existing
`['experiments', project]`, `['hypotheses', project]`,
`['journal', project]`, and post-A `['reports', project]`,
`['digests', project]`.

`staleTime: 5_000` (matches the rest of the app). `refetchOnWindowFocus`
inherits the QueryClient default.

Alternative considered: a single `/api/project-counts?project=X`
endpoint returning `{ experiments, hypotheses, journal, reports, digests }`
in one round-trip. Rejected: the views already fetch the lists; piggy-
backing on those keys eliminates the round-trip entirely.

### D2. Journal count semantics

The current `getJournalData(project, { limit: 200 })` SSR fetcher
returns at most 200 events. The AppBar count must be the **total**.
Two options:

(a) Add a `?countOnly=1` short-circuit to `/api/journal` that returns
    just `{ totalEvents: number }` without paginating.
(b) Have the AppBar query call `/api/journal?project=X&limit=10000`
    (effectively no limit), trusting the journal isn't huge enough to
    matter for an unpaginated read.

Going with **(a)** — it's a one-line route addition, and (b) starts to
look bad for a long-running project that accumulates many thousands
of events. The new key will be `['journal-count', project]` to avoid
sharing cache with the limited fetch the journal page uses.

Implementation: `/api/journal?project=X&countOnly=1` returns
`{ totalEvents, lastDigestAt }`. The AppBar query selects `totalEvents`.
The journal page keeps its existing limited query unchanged.

### D3. Skeleton vs `0` while loading

`useQuery` while loading returns `data === undefined`. Render a small
pulse:

```tsx
{query.isLoading ? (
  <span className="inline-block h-3 w-4 animate-pulse rounded bg-muted" />
) : (
  <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>
)}
```

This avoids the user seeing every tab flash "0" then jump to its real
value on first paint. 5 queries are mounted in parallel by React Query
so total time-to-resolved is one round-trip, not five.

### D4. Reserved slot for the warnings indicator

Each tab's right edge gets a flex container:

```tsx
<span className="ml-1 inline-flex items-center gap-1">
  <span data-slot="count">{...}</span>
  {/* future warnings system fills this: */}
  <span data-slot="warnings" />
</span>
```

The `data-slot="warnings"` span is rendered always, empty for now.
Future change selects it (or matches its data-slot) to drop in a `<dot>`
or `<icon>` without changing the parent layout. Documenting via the
data-slot attribute keeps it grep-able.

### D5. AppBar stays a client component (no SSR change)

The AppBar already runs on the client (`usePathname()`). Adding
`useQuery` doesn't change that. Server component variants of the
AppBar are not on the table; their hydration cost would be higher
than the cache observation we're adopting.

## Risks / Trade-offs

- **Stale counts on first paint after a long idle**: React Query's
  `staleTime: 5_000` means the cache is considered stale after 5
  seconds idle, so the first paint after returning to the tab fires
  fresh fetches. That's fine — the badge updates to the truth within
  one round-trip.

- **Journal totalEvents requires the route addition**. Small but real.
  → Mitigation: the existing `getJournalData` already loads the full
  parsed events array from the in-memory cache; truncation happens
  AFTER. So `?countOnly=1` is a 5-line branch in the route handler.

- **Warnings slot adds dead DOM nodes today**. Cost: one `<span>` per
  tab. Negligible.

- **Five concurrent queries on first paint**. All hit cached endpoints
  and React Query batches re-renders. Network is dev-loopback or HTTP/2
  multiplexed in prod — five small JSON GETs are a non-issue.

## Migration Plan

1. Backend: add `?countOnly=1` to `/api/journal/route.ts`. Verify by
   curl.
2. Frontend: extract a `<TabBadge kind="experiments" project={project} />`
   helper that owns the per-kind query and renders the slot. Mount it
   inside each AppBar tab. Five instances total (4 today + reports
   only after A lands; if A is still in flight, gate the reports/digests
   tabs behind A's tabs being present).
3. Snapshot test for AppBar covering loading, populated, and zero-count
   states.
4. Update `web-layout` spec.
5. Verify `openspec validate` clean.

## Open Questions

1. Should the count update with a tiny "+N" pulse animation when SSE
   delivers an invalidation? Subtle but charming. Defer — start
   without animation, add later if it feels static.

2. If the Journal totalEvents route option (D2 a) is too much surface,
   we could implement (b) as the v0 and revisit. For now staying with
   (a) because it's also useful for the future warnings system
   ("how many events since last digest?" needs a count anyway).
