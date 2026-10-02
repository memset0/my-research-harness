## ADDED Requirements

### Requirement: List heartbeats revalidate without recomputation

The browser resource protocol SHALL remember the `ETag` validator returned
with each list or inventory body and SHALL send it as `If-None-Match` on the
next request for the same URL, alongside the known semantic version. A `304`
SHALL reuse the remembered body object so nothing re-renders. When the
remembered body was evicted the client SHALL retry once without conditional
headers. An explicit `If-None-Match` SHALL be set by the client itself so the
`304` reaches the protocol code instead of being absorbed by the browser HTTP
cache. For an open tab whose list sources are unchanged, a heartbeat SHALL
cause no document body read and no list recomputation on the server.

#### Scenario: Unchanged list heartbeat
- **GIVEN** an open Experiment list holding validator `V`
- **WHEN** the 30-second heartbeat refetches it and nothing changed
- **THEN** the request carries `If-None-Match: V`, the server answers `304`, and the rendered list keeps the same data object

#### Scenario: Evicted body
- **WHEN** the server answers `304` but the client no longer holds the body for that URL
- **THEN** the client repeats the request without `If-None-Match` and renders the `200` body

### Requirement: Translation readiness never delays first paint

The body-translation readiness check SHALL NOT be requested while the page is
loading: the client SHALL defer it until the browser is idle after mount (or a
short fallback delay). The server SHALL cache the readiness outcome — success
for 10 minutes, failure for 60 seconds — and share one in-flight probe between
concurrent requests, so a repeated check answers without starting the
translation provider again.

#### Scenario: Unavailable provider
- **GIVEN** translation is enabled but the provider is not usable
- **WHEN** an owner opens two Experiment pages within a minute
- **THEN** the first deferred check probes once and the second answers from the cached failure without probing
