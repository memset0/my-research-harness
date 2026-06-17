# markdown-link-preview Specification

## Purpose
TBD - created by archiving change add-permalink-hover-preview. Update Purpose after archive.
## Requirements
### Requirement: The shared Markdown renderer previews GitHub permalinks on hover

The shared `<Markdown>` component SHALL accept a `project` prop and override link
rendering so that an href which is a GitHub blob **line-permalink**
(`https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<a>[-L<b>]`) is rendered
as a hover-preview link, while every other link renders as a plain `<a>`
unchanged. Because all dashboard markdown already routes through this one
component, the behavior SHALL apply wherever markdown is rendered (code-review
detail, experiment + run pages, reports / digests) once `project` is threaded in.

#### Scenario: Only GitHub line-permalinks are enhanced

- **GIVEN** rendered markdown containing a GitHub `blob/<sha>/<path>#L10-L20` link and an ordinary `https://example.com` link
- **THEN** the GitHub permalink gets the hover-preview affordance and the ordinary link renders as a normal `<a>`

#### Scenario: No project context ⇒ plain link

- **WHEN** `<Markdown>` is rendered without a `project` prop
- **THEN** even GitHub permalinks render as plain links (no preview attempted)

### Requirement: Hover shows the code below the link, scrollable, with the target range marked

On hover of an enhanced permalink, the component SHALL fetch the preview from
`/api/code-preview` (lazily, on first hover; cached by url) and display a popover
**below** the link containing the returned lines rendered monospaced with a
line-number gutter, the permalink's target lines visually highlighted, and a
**scroll** area when the content is taller than a max height. Loading and
error states render inside the popover; on a failed fetch the element still
behaves as a normal link to GitHub.

#### Scenario: Preview renders below with highlighted target lines

- **WHEN** the user hovers a mapped permalink and the fetch succeeds
- **THEN** a popover opens beneath the link showing the code with line numbers, the target lines highlighted, and surrounding context lines

#### Scenario: Long preview scrolls

- **WHEN** the returned code exceeds the popover's max height
- **THEN** the popover content scrolls rather than overflowing the viewport

#### Scenario: Failed fetch falls back to a normal link

- **WHEN** the preview fetch returns 404 (unmapped repo / missing sha) or errors
- **THEN** the popover shows a brief "couldn't load" note and the link still navigates to GitHub when clicked

