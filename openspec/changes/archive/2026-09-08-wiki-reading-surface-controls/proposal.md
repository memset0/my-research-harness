## Why

The reader's white background currently covers the outline and surrounding space. The fixed 720px width is also too narrow for the user's preferred reading experience.

## What Changes

- Restrict the document surface background to the document column; preserve the surrounding theme background for the outline and outer space.
- Change the default reading limit to 800px.
- Add a top-toolbar toggle between 800px and unrestricted available width, without reloading or changing page content.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-viewer`: Document-only background and adjustable reading width.

## Impact

Wiki reader components and focused tests only. No persistence, API, dependency, or review behavior changes.
