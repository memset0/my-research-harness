## Context

The auth rate limiter is a token-bucket sized for "1 sustained req/s with a 60-burst buffer". The original design explicitly throttles even successful auth, on the theory that an attacker landing the right password looks indistinguishable from a legit user until it succeeds. In practice that conflates two threat models:

- **Brute-force**: many failed attempts. Drain rate must be slow.
- **Successful credentials**: zero or one event per session per password rotation. No throttling needed; the user has already proven they hold the password.

A token-bucket that drains on success punishes the wrong cohort: legitimate users running a single-page app that fans out 20+ subrequests per navigation. We want the limiter to bound CPU + brute-force progress only, not page navigations.

Independently, the React Query setup over-fetches on every hydration: server `prefetchQuery` runs with `staleTime: 60_000` on `lib/get-query-client.ts`, but the client provider in `components/providers.tsx` uses `staleTime: 5_000`. On hydration, React Query inspects each query's `dataUpdatedAt` against the CLIENT-side `staleTime`. If `now - dataUpdatedAt > 5s`, the query refetches even though the server just delivered fresh data. Dev SSR + on-demand compile routinely takes >5s, so the refetch fires for every prefetched key.

## Goals / Non-Goals

**Goals:**
- Authenticated traffic is not bottlenecked by the auth rate limiter.
- Brute-force traffic is still bounded at ≤ 1 password attempt per second per IP via scrypt + bucket.
- A single dashboard page open does not double-fetch every prefetched query.

**Non-Goals:**
- Changing bucket capacity or refill rate. Both stay at 60.
- Changing scrypt parameters or moving credential storage.
- Touching the SSE invalidation path or background `refetchInterval`.
- Reworking server prefetch logic.

## Decisions

### D1. Refund-on-success, not skip-bucket-on-cached-auth
Two design alternatives were on the table:
- **(A)** Skip the limiter when the request carries an `Authorization` header that matches a recently-verified credential cache.
- **(B)** Always consume one token; refund it after `verifyBasic` returns ok.

Picked **(B)** because:
- It preserves the existing "consume BEFORE scrypt" property that bounds attacker CPU. A flood of bad-credential requests still pays the bucket cost up-front.
- No new credential cache to invalidate on password rotation.
- The refund is a single bounded `Math.min(capacity, tokens + 1)` mutation — trivial to reason about under contention.
- Cost on success path is one extra map lookup + arithmetic; negligible vs scrypt's ~70ms.

Failed auth (parse failure or `verifyBasic` returns false) does NOT refund — that's the only path that retains the brute-force throttle.

The 429-from-empty-bucket path remains unchanged (no consume happened; nothing to refund).

### D2. Refund applies in three call sites, all sharing the bucket
The spec already mandates one shared bucket between middleware, `/api/auth/check`, and the WebSocket-upgrade auth in `server.ts`. The refund must mirror that exactly: any code path that calls `consume(ip)` and then succeeds at auth MUST call `refund(ip)`.

`/api/auth/check` is interesting: its purpose is to validate creds, so EVERY successful call refunds. That's correct — the dashboard pings it on load to confirm credentials, and we don't want one ping per minute draining the legit user.

### D3. Align client `staleTime` to server prefetch (60_000)
React Query computes staleness from `dataUpdatedAt` against the QUERY-LEVEL `staleTime`, then falls back to default. Per-call `staleTime: 5_000` on a few queries (e.g. `useQuery({ staleTime: 5_000 })`) overrides the default; those stay as-is — they're explicitly tuned. The default change only affects queries that didn't opt out. The `refetchInterval: 60_000` background poll stays — it's the long-term safety net if SSE drops.

The 60-second alignment exactly matches `lib/get-query-client.ts`. SSR-rendered fresh data is treated as fresh on the client until 60s after `dataUpdatedAt`, by which point either SSE has invalidated (the common case) or the 60s background `refetchInterval` fires.

### D4. No bucket-size change
Tempting to bump capacity from 60 → 300, but that papers over D1. With refund-on-success the legit user is essentially un-throttled regardless of capacity; the brute-force ceiling stays at 1 password/s as the spec already requires. Leaving capacity alone keeps the brute-force math identical to today.

## Risks / Trade-offs

- [Risk] A timing oracle: the response time difference between "consume happens, scrypt runs, success → refund" and "consume happens, scrypt runs, failure → no refund" is observable. → Mitigation: the refund is fire-and-forget after the response decision is made; under the dominant scrypt ~70ms cost the extra map op is sub-microsecond. There's no observable timing difference an attacker can exploit beyond what scrypt-vs-401-401-401 already exposes.
- [Risk] If `consume` returns ok but `verifyBasic` later throws (programming error), the bucket is permanently down by one token until refill. → Mitigation: acceptable; the refill rate (1/s) recovers within seconds and the worst case is a single-token leak per crash, capped by capacity.
- [Risk] Aligning client `staleTime` to 60s could mask legitimate stale data when SSE is flaky. → Mitigation: SSE invalidation is the primary mechanism (already in production); the existing `refetchInterval: 60_000` is the timeout safety net. No change to either.
- [Risk] Spec rewording the "successful verifications SHALL also consume one token" sentence may surprise future readers expecting strict counting. → Mitigation: replace with explicit "consume on attempt, refund on success" wording so the model is unambiguous.
