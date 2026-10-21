## ADDED Requirements

### Requirement: Markdown tables of contents can be collapsed
The table of contents at the top of a Markdown Report and the "On this page" outline of a Markdown Wiki page SHALL be disclosure widgets that start expanded and that the reader can collapse and expand by activating their title with pointer or keyboard. Collapsing SHALL hide the entries without changing the document or its heading anchors; a collapsed Wiki outline SHALL shrink to its title so the document can use the freed width.

#### Scenario: Collapse a Report table of contents
- **WHEN** the reader activates the "Table of contents" title of a Markdown Report
- **THEN** the entries are hidden and activating the title again shows them

#### Scenario: Collapse the Wiki outline
- **WHEN** the reader activates "On this page" on a Markdown Wiki page
- **THEN** the outline entries are hidden and the outline column narrows to its title
