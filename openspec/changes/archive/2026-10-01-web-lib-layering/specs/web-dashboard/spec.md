## ADDED Requirements

### Requirement: Server-only dashboard modules are isolated under lib/server

Every dashboard module that may run only on the server — one that reads the
co-located Runtime, imports `node:*` built-ins, imports runtime values from
`@memon/core` or `@memon/backend`, or exists only to serve such modules and the
server entrypoints — SHALL live under `apps/web/lib/server/`. Modules under
`apps/web/lib/` outside that directory SHALL be safe to bundle for the browser.
Every non-test module under `apps/web/lib/server/` SHALL import `server-only`,
except modules reachable through value imports from the custom Node entry
`apps/web/server.ts`, which SHALL NOT import it because that entry is not
resolved by the Next.js bundler. An automated test SHALL derive the entry's
reachable set from its import graph and enforce both directions.

#### Scenario: A client component imports a guarded server module
- **WHEN** a `'use client'` module transitively imports a module under
  `apps/web/lib/server/` that imports `server-only`
- **THEN** the production `next build` fails instead of shipping server code to
  the browser

#### Scenario: A new server module is added without the guard
- **WHEN** a non-test module is added under `apps/web/lib/server/` that the
  custom entry does not reach and that does not import `server-only`
- **THEN** the layering test fails and names the module

#### Scenario: The custom entry keeps booting
- **WHEN** a module reachable from `apps/web/server.ts` imports `server-only`
- **THEN** the layering test fails before the change can break the Node entry

### Requirement: API routes and client fetchers share response DTO types

The response body types that client fetchers in `apps/web/lib/api.ts` declare
for `/api/*` routes SHALL be defined once under `apps/web/lib/dto/` and used by
both the fetchers and the `app/api/**/route.ts` handlers that build those
bodies, so a handler whose literal JSON body disagrees with the client's type
fails typecheck. DTO modules SHALL contain only types and pure functions and
SHALL NOT import server-only modules. Sharing the types SHALL NOT change any
response's wire shape.

#### Scenario: A route drifts from its client type
- **WHEN** a route handler changes a field of a JSON body annotated with its DTO
  type so that it no longer matches the client's expectation
- **THEN** `pnpm --filter @memon/web typecheck` fails at that handler

#### Scenario: DTO modules stay browser-safe
- **WHEN** a client component imports a type or helper from `apps/web/lib/dto/`
- **THEN** no server-only module enters the browser bundle
