## ADDED Requirements

### Requirement: Shared wiki figures use slug-named image assets

The wiki SHALL reserve `docs/wiki/assets/` for shared images and exclude that directory from page discovery. Images SHALL use lowercase kebab-case basenames with SVG, PNG, JPG, JPEG, WebP, GIF, or AVIF extensions. `GET|HEAD /api/wiki-assets/<project>/shared/<slug>.<extension>` SHALL serve only these image paths from that directory, preserving project authorization, Host routing, MIME types, validators, and byte ranges. Lexical traversal, encoded traversal, nested paths, unsupported extensions, and symlink escapes from the assets directory SHALL be rejected. Responses SHALL include nosniff and a restrictive sandbox CSP so direct SVG navigation cannot execute scripts. Existing W-id bundle asset behavior SHALL remain unchanged.

#### Scenario: Shared image in either page format
- **WHEN** a single-file or bundle wiki page references the same shared figure asset
- **THEN** both load the project-scoped image without duplicating it or moving the page

#### Scenario: Shared directory is not a page kind
- **WHEN** files exist inside `docs/wiki/assets/`, including a Markdown filename resembling a wiki page
- **THEN** none are discovered as wiki pages

#### Scenario: Asset containment and authorization
- **WHEN** an image request attempts an encoded traversal or follows a symlink outside the shared assets directory
- **THEN** it is rejected without serving the target
- **AND** anonymous or out-of-scope visitors cannot read shared images through the existing project authorization layer

### Requirement: Figure component retains captions and agent-readable descriptions

The central registry SHALL register `figure@1`, with no info-string attributes and a strict YAML mapping containing required nonempty strings `slug`, `src`, `caption`, and `description`. `slug` SHALL be lowercase kebab-case; `src` SHALL be `assets/<slug>.<supported-image-extension>`, with its basename matching `slug`. External URLs, absolute paths, data URLs, traversal, unsupported file types, and unknown fields SHALL produce `WIKI_COMPONENT_INVALID` and render the block verbatim rather than loading a resource.

With a project context the renderer SHALL display the referenced image in a semantic figure and its caption visibly below it. The description SHALL remain in Markdown source and serve as the image's alternative text so agents and assistive technologies can understand the image without decoding it. SVG SHALL render through an image element, never raw SVG/HTML injection or an iframe. Images SHALL fit the available content width on desktop and mobile. Missing project context or an image load failure SHALL show a readable fallback retaining caption and description, without breaking surrounding content. Text/Markdown projection SHALL retain all figure fields. Registry introspection SHALL document the contract and include valid, invalid, and rendered examples. The CLI and Backend SHALL keep component payloads opaque as for existing components.

#### Scenario: Agent-authored SVG
- **WHEN** a valid figure block references `assets/pipeline-overview.svg`
- **THEN** the SVG appears as an image with its visible caption and description as alternative text

#### Scenario: User-provided raster image
- **WHEN** a valid figure block references `assets/reference-diagram.png`
- **THEN** the same figure treatment renders the image without requiring SVG conversion

#### Scenario: Invalid or unavailable image
- **WHEN** the payload has an external src or a missing description
- **THEN** component lint identifies the invalid field and the original block remains readable
- **WHEN** the payload is valid but the local image fails to load
- **THEN** a readable error replaces the image while its caption and description remain available
