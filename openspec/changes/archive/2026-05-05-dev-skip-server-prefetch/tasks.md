## 1. Implementation

- [x] 1.1 In `apps/web/lib/get-query-client.ts` (server branch of `getQueryClient`), when `process.env.NODE_ENV !== 'production'`, replace the returned client's `prefetchQuery` with `(async () => {}) as typeof qc.prefetchQuery`. Inline comment explains the dev-only intent and points at the spec carve-out.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` clean.
- [x] 2.2 Restart `pnpm dev`, ensure the server boots with the warmup line and a clean ready-message.
- [x] 2.3 Curl a project page: response status 200, HTML contains the expected shell markup. Confirm the dehydrated `__NEXT_DATA__` (or equivalent React Query payload) does NOT contain entries for the page's prefetched query keys (since `prefetchQuery` was a no-op).
- [x] 2.4 Production sanity: this change is gated on `NODE_ENV !== 'production'`. No production smoke needed beyond the typecheck — the override is conditional and matches the spec.
