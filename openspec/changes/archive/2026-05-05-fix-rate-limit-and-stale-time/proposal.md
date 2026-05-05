## Why

Authenticated users are getting `429 Too Many Requests` while just navigating the dashboard. Two independent bugs combine:

1. **Rate-limit bucket counts authenticated traffic.** `apps/web/middleware.ts` consumes one token from the per-IP bucket for every request, BEFORE `verifyBasic` runs. The token is never returned on auth success, so a logged-in user is throttled at the same `1 sustained req/s` ceiling as a brute-force attacker. The current spec for the limiter explicitly endorses this ("Successful verifications SHALL also consume one token") on the rationale that "under attack a successful guess looks identical until it succeeds" — but that rationale is incorrect: the attacker's successful guess only looks like a legit user IFF the password is already broken, at which point throttling them costs the legitimate user too. The brute-force defense should drain only on FAILED auth.

2. **Hydration triggers a full refetch storm.** Server prefetch uses `staleTime: 60_000` (`apps/web/lib/get-query-client.ts`); the client `Providers` uses `staleTime: 5_000` (`apps/web/components/providers.tsx`). SSR + on-demand compile in dev frequently take >5s, so EVERY prefetched query is already stale when the client mounts the `<HydrationBoundary>`. Result: every dashboard page open fires every query twice (visible in the dev log as duplicated `/api/experiments?project=…`, `/api/journal?…&countOnly=1`, `/api/hypotheses?…`, `/api/digests`, `/api/reports` lines). Combined with bug #1 this drains the bucket in 2–3 page opens.

## What Changes

- **BREAKING (spec)** modify the rate-limit semantics: tokens consumed by `verifyBasic` SHALL be refunded on auth success in middleware AND in the custom server's WebSocket-upgrade auth path. `/api/auth/check` already explicitly tests success-paths against the limiter; refund applies there too. The bucket continues to drain on **failed** verifications (the brute-force defense remains intact). Bucket is still consumed BEFORE scrypt to bound CPU.
- Add a `refund(key, now?)` helper to `apps/web/lib/auth/rate-limit.ts` that returns one token (capped at capacity) and is safe to call after `consume`.
- Align client React Query `staleTime` with server prefetch (`60_000`) in `apps/web/components/providers.tsx`. SSE remains the primary invalidation channel; the `staleTime` change only stops the redundant on-hydration refetch.
- Update tests for `middleware.ts`, `apps/web/app/api/auth/check/route.ts`, the WebSocket-upgrade auth path in `server.ts`, and `lib/auth/rate-limit.ts` to cover refund behaviour.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `auth-system`: rate-limit semantics — successful verifications no longer consume a token (refund on success); failed verifications still drain.
- `live-updates`: SSR-prefetched queries SHALL NOT refetch immediately on hydration; client-side `staleTime` is aligned to server prefetch.

## Impact

- Code:
  - `apps/web/lib/auth/rate-limit.ts` — add `refund()`
  - `apps/web/middleware.ts` — call `refund` on auth success
  - `apps/web/app/api/auth/check/route.ts` — call `refund` on auth success
  - `apps/web/server.ts` — call `refund` on successful WebSocket-upgrade auth (shares same bucket per existing spec)
  - `apps/web/components/providers.tsx` — `staleTime: 60_000`
- Tests: `lib/auth/rate-limit.test.ts`, `middleware.test.ts`, `app/api/auth/check/route.test.ts`, `lib/auth/server-auth.test.ts` — assert that 60+ correct-credential requests in a burst all succeed (token refunded), and 60+ wrong-credential requests still trigger 429.
- No on-disk format change. No API surface change. Spec deltas: `auth-system`, `live-updates`.
