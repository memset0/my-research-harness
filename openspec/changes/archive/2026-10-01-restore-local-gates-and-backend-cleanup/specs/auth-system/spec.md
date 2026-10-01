## ADDED Requirements

### Requirement: Server-rendered project pages hydrate only resources of the requested project

A server-rendered page under `/p/<project>/…` that resolves a resource by id (for example the Run detail page `/p/<project>/experiments/<id>`) SHALL verify that the resolved resource belongs to `<project>` before rendering, generating metadata, or dehydrating any of its data into the HTML. A resource that exists only in another project SHALL produce the same 404 as a missing id, and its title, README body or frontmatter SHALL NOT appear in the response. This applies to owners and viewers alike; for a viewer, route-level scope checks on `<project>` are therefore sufficient to keep another project's content out of the page.

#### Scenario: Viewer requests another project's Run through an in-scope URL

- **GIVEN** a viewer whose share scope covers `project-a` only
- **AND** a Run id that exists in `project-b` but not in `project-a`
- **WHEN** the viewer requests `/p/project-a/experiments/<that id>`
- **THEN** the response is a 404
- **AND** neither the HTML nor the page title contains that Run's README content or slug

#### Scenario: Matching project renders with a usable prefetch

- **GIVEN** a Run that belongs to `project-a`
- **WHEN** an authorized user requests `/p/project-a/experiments/<id>`
- **THEN** the page renders the Run detail
- **AND** the dehydrated query uses the same key the client detail component reads, so no duplicate fetch is required on mount
