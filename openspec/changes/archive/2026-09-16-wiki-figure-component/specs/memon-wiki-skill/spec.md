## ADDED Requirements

### Requirement: Component authoring constrains which images a figure may use

The `memon-components` skill SHALL tell the agent to keep a figure's image beside the containing document (normally in its `<stem>__assets/` directory) with a descriptive kebab-case file name, to preserve user-provided image bytes unless a transformation is requested, to ask before downloading or inserting any image the user did not supply or explicitly authorize, and never to hotlink. Agent-drawn SVG SHALL be self-contained: no scripts, event handlers, `foreignObject`, external fonts, or external image/resource references. The `description` SHALL be grounded in the actual image (its labels, relationships, axes, encodings) or the user's supplied description; when the agent cannot establish what an image shows it SHALL ask instead of inventing a description.

#### Scenario: User supplies a reference image
- **WHEN** the user asks to insert an image they provided
- **THEN** the agent saves its original bytes beside the document, writes the block with an accurate caption and description, and verifies the rendered page

#### Scenario: Drawing an explanatory SVG
- **WHEN** an agent creates a diagram for a page
- **THEN** it saves a self-contained SVG beside the document and describes its actual nodes, labels, and relationships in the block

#### Scenario: External image is not authorized
- **WHEN** an agent finds a potentially useful image that the user has not supplied or authorized
- **THEN** it asks before downloading or inserting it

#### Scenario: Skill states the rule
- **WHEN** a reader greps `packages/skills/memon-components/SKILL.md` for `hotlink` and for `foreignObject`
- **THEN** each matches at least once
