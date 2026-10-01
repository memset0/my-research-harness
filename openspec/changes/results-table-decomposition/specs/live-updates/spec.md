## MODIFIED Requirements

### Requirement: TanStack query keys come from one factory

Every TanStack Query key used by the dashboard — for reads, server-side
prefetches, cache writes, invalidations, cancellations and manual refreshes —
SHALL be produced by the key factory in `apps/web/lib/query-keys.ts`; no other
module SHALL spell a key as an array literal. Project-scoped keys SHALL embed
the Project as the plain Project name, or as Host then Project name for a
Host-qualified Project, immediately after the key's root string. The runtime
shape of each key SHALL be locked by a snapshot test so that a prefetch, a read
and an invalidation of the same resource keep matching. The factory SHALL NOT
offer a second constructor for the same resource whose Project segment uses a
different shape.

#### Scenario: Server prefetch hydrates the client read
- **WHEN** a project page prefetches a resource on the server and the client
  component reads the same resource
- **THEN** both use the same factory constructor and the client finds the
  dehydrated entry without refetching

#### Scenario: A write invalidates the matching reads
- **WHEN** a write invalidates a resource through the factory
- **THEN** the invalidation key is a prefix of the key every reader of that
  resource uses

#### Scenario: A Host-qualified write refreshes its list
- **GIVEN** the Report list of a Host-qualified Project is being read
- **WHEN** a Report of that Project is saved from the Inbox editor
- **THEN** the Report list query is invalidated and refetched

#### Scenario: A key shape changes
- **WHEN** a factory constructor's runtime output changes
- **THEN** its snapshot test fails until the change is reviewed
