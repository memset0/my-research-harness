# Spec Delta

## Purpose
Per-account API tokens let the memon CLI and scripts on any device authenticate to central with exactly the reach of the account that owns the token.

## ADDED Requirements

### Requirement: Accounts hold named API tokens
An account SHALL be able to hold API tokens, each with a name (1–64 characters), a creation time, an optional expiry and a last-used time. A token value SHALL be `mtk_` followed by at least 32 random characters, returned only in the response that creates it, and stored only as a hash. Tokens SHALL be managed through `/api/tokens`. Any signed-in `super_admin`, `admin` or `user` account SHALL list (`GET`), create (`POST {name, expires_at?}`) and revoke (`DELETE /api/tokens/<id>`) its own tokens. The super admin SHALL also list and revoke any account's tokens. Disabling or deleting an account, or changing its level, SHALL revoke its tokens.

#### Scenario: Token is shown once
- **WHEN** admin `ada` creates a token named `laptop`
- **THEN** the response contains its value, and a later `GET /api/tokens` lists `laptop` without any value

#### Scenario: Admin cannot see other accounts' tokens
- **WHEN** admin `ada` lists tokens or revokes a token id that belongs to `bob`
- **THEN** the list contains only ada's tokens and the revoke answers `404`

#### Scenario: Level change revokes
- **WHEN** the super admin changes `ada` from `admin` to `user`
- **THEN** every token ada held stops authenticating

### Requirement: Bearer tokens authenticate as their account
A request carrying `Authorization: Bearer <token>` SHALL be resolved as the token's account at that account's current level and grants, exactly as a signed-in session of that account would be, for page, API and WebSocket routes alike. An unknown, revoked or expired token, or one whose account is disabled, SHALL answer `401` and SHALL NOT fall back to other credentials on the same request. A successful use SHALL update the token's last-used time at most once a minute. Failed Bearer attempts SHALL count against the existing authentication rate limit.

#### Scenario: Token from another device
- **GIVEN** admin `ada` holds a valid token
- **WHEN** a CLI on another machine requests `GET /api/gpu-pool/tickets` with it over central's public URL
- **THEN** the request is served as ada

#### Scenario: Expired token
- **WHEN** a request carries a token whose `expires_at` has passed
- **THEN** the response is `401` and nothing is served

### Requirement: The CLI logs in to a central URL
`memon login <central-url>` SHALL read a token from standard input (or prompt for it on a terminal), verify it against `<central-url>`, and store `{url, token}` in `~/.config/memon/central.json` with mode 0600. `memon logout` SHALL delete that file. Central-facing commands SHALL take the URL and credentials from, in order: `MEMON_CENTRAL_URL` plus `MEMON_CENTRAL_TOKEN`, then `central.json`, then the legacy `MEMON_CENTRAL_AUTH` or `~/.config/memon/central-auth` Basic credentials against `http://localhost:3737`. No credential SHALL ever be printed.

#### Scenario: Login stores the credential privately
- **WHEN** an agent runs `memon login https://central.example` and pipes a valid token
- **THEN** `~/.config/memon/central.json` exists with mode 0600 and `memon ticket list` succeeds against that URL

#### Scenario: Bad token at login
- **WHEN** the piped token is rejected by central
- **THEN** login exits with `FORBIDDEN` and writes nothing
