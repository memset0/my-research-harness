## 1. rate-limit refund helper

- [x] 1.1 Add `refund(key: string, now?: number): void` to `apps/web/lib/auth/rate-limit.ts`. Must lazy-create the bucket if missing (same as `consume`), refill first, then `b.tokens = Math.min(CAPACITY, b.tokens + 1)`. No return value.
- [x] 1.2 Extend `lib/auth/rate-limit.test.ts` with a unit case: bucket at 0 → `refund` brings it to 1; bucket at capacity → `refund` is a no-op.

## 2. Wire refund into the three auth call sites

- [x] 2.1 In `apps/web/middleware.ts`, after `verifyBasic` returns `true`, call `refund(ip)` before `return NextResponse.next()`.
- [x] 2.2 In `apps/web/app/api/auth/check/route.ts`, after the successful-auth path, call `refund(ip)` before returning 200. (Inspect the file to confirm where consume + verify happen and mirror the structure.)
- [x] 2.3 In `apps/web/server.ts` (custom server WebSocket-upgrade auth), find the path where `consume(...)` is called and `verifyBasic` returns ok; refund before forwarding the upgrade.

## 3. Update tests for refund-on-success

- [x] 3.1 In `apps/web/middleware.test.ts`, add: 100 sequential VALID-credential requests from the same IP all return 200 (no 429) — proves refund.
- [x] 3.2 In `apps/web/middleware.test.ts`, add a mixed scenario: 30 wrong + 60 correct → first 30 are 401, next 60 are all 200, no 429.
- [x] 3.3 In `apps/web/app/api/auth/check/route.test.ts`, add: 100 sequential VALID-credential requests all return 200; the existing "exhausted bucket → 429" case still passes for the wrong-credential variant.
- [x] 3.4 In `apps/web/lib/auth/server-auth.test.ts`, ensure the helper used by `server.ts` upgrade auth has a refund-on-success test (or add one if not present).

## 4. Align client React Query staleTime

- [x] 4.1 In `apps/web/components/providers.tsx`, change `staleTime: 5_000` to `staleTime: 60_000` to match `lib/get-query-client.ts`. Leave `refetchInterval: 60_000`, `refetchOnWindowFocus`, and `retry` untouched.
- [x] 4.2 Audit per-call `useQuery({ staleTime: ... })` overrides under `apps/web/components` and `apps/web/lib`. Per-call overrides at SHORTER values are intentional opt-ins; do NOT change them. (`useItemsList` has `staleTime: 5_000` for inbox lists — keep as-is; the spec scenario explicitly preserves per-query overrides.)

## 5. Verification

- [x] 5.1 `pnpm --filter @memon/web typecheck`
- [x] 5.2 `pnpm --filter @memon/web test` — all suites pass.
- [x] 5.3 Live curl regression: read credentials from `config.yml`; fire 80 sequential authenticated GETs against `/api/projects` and assert all return 200. With refund-on-success the bucket holds steady; without it (today) requests 60+ would return 429.
- [x] 5.4 Live dev-log inspection: tail `/tmp/memon-dev.log`, open a fresh project page in the browser, confirm the prefetched query keys (`/api/experiments?project=…`, `/api/hypotheses?project=…`, `/api/journal?…&countOnly=1`, `/api/digests`, `/api/reports`) appear AT MOST ONCE within 1 s of the page GET (no immediate duplicate refetch).
