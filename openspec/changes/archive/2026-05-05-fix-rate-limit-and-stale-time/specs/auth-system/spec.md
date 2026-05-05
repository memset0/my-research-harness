## MODIFIED Requirements

### Requirement: Rate limit on auth-check and middleware basic-auth verification

The `/api/auth/check` endpoint AND the per-request `Authorization: Basic` verification done in middleware SHALL share an in-process token-bucket rate limiter keyed by client IP. Default policy: **capacity 60, refill 60 tokens per 60 seconds** (= 1 sustained req/s/IP with a 60-burst buffer). The limit bounds an external attacker to O(1 password/s) which, against a 144-bit random password, makes brute-force infeasible.

The limiter SHALL behave as **consume-on-attempt, refund-on-success**:

1. Every request that reaches the verification path consumes one token from the bucket BEFORE the timing-safe password compare runs (so a flood of failed attempts pays the bucket cost up-front and bounds CPU).
2. When the bucket is empty, the response SHALL be `429 Too Many Requests` with header `Retry-After: <seconds-until-next-token>`, and the server SHALL NOT perform the timing-safe password compare.
3. When verification succeeds (`verifyBasic` returns ok), the previously-consumed token SHALL be refunded back to the bucket (capped at the bucket's capacity). Failed verifications SHALL NOT refund — that is the brute-force throttle.

The net effect is that legitimate, authenticated traffic is not throttled by the bucket, while an attacker submitting wrong passwords drains at the spec's `1 password/s` ceiling.

Client IP SHALL be derived from the last entry of the `X-Forwarded-For` request header when present (Caddy is the only trusted upstream hop), falling back to the request's remote socket address. The limiter state SHALL be in-memory only and reset on process restart; this is acceptable for a single-user system. The limiter SHALL be shared between middleware and `/api/auth/check` so a brute-force attempt against either path is counted in one bucket.

#### Scenario: Within rate limit
- **WHEN** the same IP makes a burst of bad-credential requests up to the bucket capacity
- **THEN** all receive 401 (after timing-safe password compare fails)

#### Scenario: Over rate limit
- **WHEN** an additional bad-credential request from the same IP arrives once the bucket is empty
- **THEN** the response is 429 with header `Retry-After: <int>` and the server skips the password compare
- **AND** the body is short (`Too Many Requests`)

#### Scenario: Successful verifications do not drain the bucket
- **GIVEN** an IP whose bucket starts at full capacity
- **WHEN** that IP makes 100 sequential requests with VALID credentials (more than the bucket's capacity of 60)
- **THEN** every request returns 200 (no 429s)
- **AND** at the end the bucket is still effectively at capacity (each consume was matched by a refund-on-success)

#### Scenario: Failed verifications still drain
- **GIVEN** an IP whose bucket starts at full capacity (60 tokens)
- **WHEN** the IP submits 61 requests with WRONG credentials in tight succession
- **THEN** the first 60 receive 401 (bucket drained one per failure)
- **AND** the 61st receives 429 (no refund happened on the prior failures)

#### Scenario: Mixed success and failure
- **GIVEN** a bucket at full capacity
- **WHEN** the IP submits 30 wrong-credential requests followed by 60 correct-credential requests
- **THEN** the 30 wrong attempts return 401 and drop the bucket from 60 to 30
- **AND** the subsequent 60 correct attempts each return 200 and net-zero the bucket (each consume refunded)
- **AND** no 429 is emitted at any point in the sequence

#### Scenario: Different IPs have independent buckets
- **WHEN** IP A is rate-limited and IP B has not made any requests
- **THEN** IP B's request is processed normally and gets 401 / 200 per credential validity

#### Scenario: X-Forwarded-For respected
- **WHEN** a request arrives at `127.0.0.1:3737` (from Caddy) with `X-Forwarded-For: 203.0.113.5, 127.0.0.1`
- **THEN** the limiter keys on `203.0.113.5`, not the socket peer
- **AND** the test asserts that two requests from different `X-Forwarded-For` last-entries are tracked independently

### Requirement: Custom server enforces HTTP Basic on WebSocket upgrade for `/api/terminal/proxy/*`

The Node `http.Server` underlying memon's process SHALL gate every WebSocket upgrade whose path begins with `/api/terminal/proxy/` behind the same HTTP Basic credentials as the rest of the dashboard. The check SHALL share the same code path as `apps/web/middleware.ts` — i.e., parse the `Authorization` header, run scrypt-based `verifyBasic` against `runtime.auth`, and consume the same per-IP rate-limit bucket — so credential rotation, brute-force defense, and constant-time comparison do not have to be re-implemented for the upgrade case. The same **consume-on-attempt, refund-on-success** semantics apply: a successful upgrade refunds its token; a failed one does not.

If verification fails, the server SHALL write a raw `HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="memon"\r\n\r\n` to the socket and destroy it; ttyd SHALL receive no upgrade. If verification succeeds, the upgrade SHALL be forwarded to `127.0.0.1:7682` and the WebSocket SHALL be piped end-to-end.

#### Scenario: Anonymous WebSocket upgrade is rejected at the server entry
- **WHEN** an anonymous client opens `ws://<host>/api/terminal/proxy/<sess>/ws` with no `Authorization` header
- **THEN** the custom server writes `HTTP/1.1 401 Unauthorized` with `WWW-Authenticate: Basic realm="memon"` and destroys the socket
- **AND** the ttyd subprocess receives no upgrade

#### Scenario: Authenticated WebSocket upgrade reaches ttyd
- **WHEN** the client opens the upgrade with valid `Authorization: Basic` matching `runtime.auth`
- **THEN** the upgrade is forwarded to `127.0.0.1:7682`
- **AND** the response is `HTTP/1.1 101 Switching Protocols`
- **AND** the rate-limit token consumed for the attempt is refunded (the upgrade does not draw down the bucket)

#### Scenario: Brute-force on the upgrade endpoint is rate-limited
- **WHEN** a client sends ≥61 upgrade attempts with bad credentials in under 60 s from the same IP
- **THEN** the first 60 are rejected at the auth check (no refund happens) and the 61st upgrade attempt receives `HTTP/1.1 429 Too Many Requests` from the same shared rate-limit bucket used by `/api/auth/check` and middleware
- **AND** the bucket is consumed exactly once per upgrade attempt (no double-counting between middleware and the custom server)
