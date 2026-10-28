## ADDED Requirements

### Requirement: Page URL mirrors the embedded document location

On a full Report or Wiki page with an HTML or service embed, the page URL SHALL follow the same-origin frame location after every load, fragment change and History API update, by replacing (never pushing) the page URL: the frame fragment SHALL become the page fragment, and a frame path or query that differs from the entry document SHALL be stored in the `view` parameter relative to the entry's directory, which SHALL be removed when the frame is back at the entry. Other parameters SHALL be kept. Opening a page URL SHALL start the frame at its `view` and fragment; a page fragment changed afterwards SHALL be applied to the frame. Locations outside the entry's directory or origin SHALL be neither mirrored nor restored.

#### Scenario: Dashboard fragment survives a reload
- **WHEN** the owner clicks inside a live Report so its frame moves to `#/eval/run-1`, then reloads the page
- **THEN** the page URL ends in `#/eval/run-1` and the frame opens there

#### Scenario: Escaping view is ignored
- **WHEN** a page URL carries `view=../../secret`
- **THEN** the frame opens at the entry document
