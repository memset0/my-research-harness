## MODIFIED Requirements

### Requirement: The shared Markdown renderer previews GitHub permalinks on hover

The shared `<Markdown>` component SHALL accept a `project` prop and override link
rendering so that an href which is a GitHub blob **line-permalink**
(`https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<a>[-L<b>]`) is rendered
as a hover-preview link, while every other link renders as a plain `<a>`
unchanged. Because all dashboard markdown already routes through this one
component, the behavior SHALL apply wherever markdown is rendered (code-review
detail, experiment + run pages, reports / wiki pages) once `project` is threaded in.

#### Scenario: Only GitHub line-permalinks are enhanced

- **GIVEN** rendered markdown containing a GitHub `blob/<sha>/<path>#L10-L20` link and an ordinary `https://example.com` link
- **THEN** the GitHub permalink gets the hover-preview affordance and the ordinary link renders as a normal `<a>`

#### Scenario: No project context ⇒ plain link

- **WHEN** `<Markdown>` is rendered without a `project` prop
- **THEN** even GitHub permalinks render as plain links (no preview attempted)
