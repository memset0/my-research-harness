## ADDED Requirements

### Requirement: Component authoring supports authorized local figures

The `memon-author-components` skill SHALL route illustrations needing a caption and agent-readable description to the registered figure component, reading its current contract through `memon wiki components show figure@1` rather than duplicating its field reference. The skill SHALL permit agent-authored SVG and user-provided or explicitly user-authorized images, stored under `docs/wiki/assets/` with descriptive kebab-case slugs. It SHALL preserve original user-provided image bytes unless transformation is requested, avoid overwriting unrelated slug collisions, and prohibit unapproved downloads or hotlinks. Agent-authored SVG SHALL be self-contained without scripts, event handlers, foreignObject, or external resource references. Descriptions SHALL be grounded in the drawing, an inspected image, or user-provided information; the agent SHALL ask when an accurate description cannot be established instead of inventing visual facts. The skill SHALL verify the asset exists, lint the block, and inspect the rendered image and caption when the dashboard is available.

#### Scenario: User supplies a reference image
- **WHEN** the user asks to insert an image they provided
- **THEN** the agent saves its original bytes under a descriptive shared asset slug, reads the figure registry contract, writes the block with an accurate caption and description, and verifies it

#### Scenario: Drawing an explanatory SVG
- **WHEN** an agent creates a diagram for a wiki page
- **THEN** it saves a self-contained SVG under the shared assets directory and describes its actual nodes, labels, relationships, and relevant visual encodings in the figure block

#### Scenario: External image is not authorized
- **WHEN** an agent finds a potentially useful image that the user has not supplied or authorized
- **THEN** it asks before downloading or inserting it
