## MODIFIED Requirements

### Requirement: `figure@1` shows a document-relative or absolute image

`figure@1` SHALL accept `image` (a path relative to the containing document, or an absolute path), `caption` (non-empty), and optional `description` (used as alt text). The image SHALL be served only when its real path is inside a configured project root (`assertWithinProjectRoots`); otherwise, or on load failure, the block SHALL render the caption and description with a readable notice instead of an image.

#### Scenario: Image beside the page
- **WHEN** `docs/wiki/note/W0009-gallery.md` declares `image: W0009-gallery__assets/pipeline.svg`
- **THEN** the image is served from that directory and the caption renders below it

#### Scenario: Escaping path is refused
- **WHEN** `image: ../../../../etc/hostname` or an absolute path outside every project root is declared
- **THEN** no file is read and the block shows the notice with the caption

#### Scenario: SVG is drawn as an image, never inlined
- **WHEN** `image` names an SVG that contains a `<script>` element
- **THEN** it is displayed through an image element served with a restrictive CSP and the script never executes in the page
