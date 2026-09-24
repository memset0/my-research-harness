## RENAMED Requirements

- FROM: `### Requirement: `figure@1` shows a document-relative or absolute image`
- TO: `### Requirement: `figure@1` shows a document-relative or absolute image or video`

## MODIFIED Requirements

### Requirement: `figure@1` shows a document-relative or absolute image or video

`figure@1` SHALL accept exactly one of `image` or `video` (each a path relative to the containing document, or an absolute path), `caption` (non-empty), optional `description` (used as alt text or the video's accessible description), and, with `video` only, optional `poster` (an image path in the same form). A video SHALL render as a thumbnail with a play control and SHALL NOT download or play the video until the reader activates it: the thumbnail is the `poster` image when given, otherwise a frame the browser reads through ranged metadata requests without fetching the whole file. Activating it SHALL load the video with native controls and start playback. Every referenced file SHALL be served only when its real path is inside a configured project root (`assertWithinProjectRoots`); otherwise, or on load failure, the block SHALL render the caption and description with a readable notice instead of the media.

#### Scenario: Image beside the page
- **WHEN** `docs/wiki/note/W0009-gallery.md` declares `image: W0009-gallery__assets/pipeline.svg`
- **THEN** the image is served from that directory and the caption renders below it

#### Scenario: Escaping path is refused
- **WHEN** `image: ../../../../etc/hostname` or an absolute path outside every project root is declared
- **THEN** no file is read and the block shows the notice with the caption

#### Scenario: SVG is drawn as an image, never inlined
- **WHEN** `image` names an SVG that contains a `<script>` element
- **THEN** it is displayed through an image element served with a restrictive CSP and the script never executes in the page

#### Scenario: Video waits for the reader
- **GIVEN** `video: W0009-gallery__assets/rollout.mp4` with `poster: W0009-gallery__assets/rollout.jpg`
- **WHEN** the page renders
- **THEN** only the poster image is requested and a play control is shown over it
- **AND** activating the control requests the video and starts playback with native controls

#### Scenario: Image and video together are invalid
- **WHEN** a block declares both `image` and `video`, or `poster` without `video`
- **THEN** the block is invalid with `WIKI_COMPONENT_INVALID` naming the field
