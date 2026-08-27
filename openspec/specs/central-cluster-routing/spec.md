# central-cluster-routing Specification

## Purpose
Defines the protected central Host registry, exact Backend routing, transport normalization, and isolated Host availability behavior.

## Requirements

### Requirement: Central registry is local, protected, and comment-preserving
Central SHALL load Host entries from the selected Git-ignored instance configuration. Host IDs and active tokens SHALL be unique; each Host SHALL select exactly one transport and one Backend token. On POSIX, configurations containing service tokens SHALL be owner-only regular files in owner-only secret/state directories. Runtime validation/status SHALL redact tokens and SHALL NOT rewrite registry fields or Agent-maintained comments.

#### Scenario: Unsafe permissions fail before listen
- **WHEN** a central instance configuration containing Backend tokens is group- or world-readable
- **THEN** central refuses startup before opening its public listener and reports a redacted permission error

#### Scenario: Comments survive auth initialization
- **WHEN** central first-run initialization adds missing human auth values
- **THEN** Host registry values and adjacent operations comments remain byte-preserved

### Requirement: URL and SSH transports normalize to one upstream
`url` transport SHALL use an explicitly configured private HTTP(S) base URL. `ssh` transport SHALL establish one gateway-owned, loopback-only local forward to the remote loopback Backend using argv execution, batch mode, identities-only, strict pinned host-key checking, exit-on-forward-failure, keepalive, and no remote command. Ordinary API, SSE, and terminal traffic SHALL use the same normalized Backend upstream.

#### Scenario: SSH tunnel becomes usable only after authenticated readiness
- **WHEN** SSH forwarding succeeds for a configured Host
- **THEN** central marks it usable only after service-authenticated metadata matches the expected Host and compatible release

#### Scenario: URL and SSH Hosts expose the same behavior
- **WHEN** equivalent Backends are registered once via `url` and once via `ssh`
- **THEN** routing, authentication, events, streaming, and terminal behavior follow the same contract

### Requirement: Gateway routes to exactly one configured Host
Every Host-scoped request SHALL resolve a validated Host ID to exactly one registry entry. Browser input SHALL NOT supply an upstream authority or arbitrary Backend path. Missing/unknown/ambiguous Host selectors SHALL fail, and the gateway SHALL NOT broadcast a GET or mutation or return a first matching resource.

#### Scenario: Missing Host cannot mutate
- **WHEN** a central mutation lacks a Host selector
- **THEN** the gateway rejects it before contacting any Backend

#### Scenario: Duplicate resource names do not trigger probing
- **WHEN** two Hosts contain the same Project and resource IDs
- **THEN** a request with Host A reaches only Host A and no request is sent to Host B

### Requirement: Gateway prevents credential forwarding and SSRF
Gateway Backend requests SHALL be constructed from an allow-list and SHALL strip browser credentials, forwarding/internal headers, hop-by-hop headers, and `Connection`-named headers before injecting the selected Backend token and validated actor context. Configured Backend URLs SHALL reject userinfo, query, fragment, unapproved path, and redirect-based authority changes; redirects SHALL not be followed with credentials.

#### Scenario: Malicious browser headers are not trusted
- **WHEN** a browser sends forged `Authorization`, `Cookie`, `Forwarded`, or `X-Memon-*` headers
- **THEN** none reach the Backend and only central-derived identity is used

#### Scenario: Backend redirect cannot exfiltrate token
- **WHEN** a Backend response redirects to another authority
- **THEN** central does not follow the redirect with the service token or relay an unsafe Location to the browser

### Requirement: Host state distinguishes failure classes
Central SHALL keep every configured Host visible and distinguish `connecting`, `offline`, `authentication_failed`, `identity_mismatch`, `misconfigured`, `filesystem_migration_required`, `upgrade_required`, `central_update_required`, `update_available`, and `online`. Only `online` and `update_available` SHALL serve data. Safe diagnostics SHALL include version/capability/timing context without secrets or raw SSH output.

#### Scenario: Bad token is not reported as network outage
- **WHEN** transport connects but Backend rejects the service token
- **THEN** the Host is `authentication_failed`, not `offline`

#### Scenario: One Host failure is isolated
- **WHEN** Host A is offline while Host B is online
- **THEN** Host A remains visible without stale Project payloads and Host B continues serving normally

### Requirement: Runtime and operations paths remain separate
Gateway-managed SSH SHALL be limited to runtime forwarding. Agent-driven install/update/restart SHALL use a separately authorized operations SSH session and the local native CLI according to the Git-ignored runbook; central SHALL NOT initiate unattended fleet updates.

#### Scenario: Runtime token cannot update a Host
- **WHEN** only the Backend service token and runtime tunnel principal are available
- **THEN** no installation, Git update, or daemon-control operation is authorized
