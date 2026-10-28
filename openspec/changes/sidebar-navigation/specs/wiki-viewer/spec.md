## ADDED Requirements

### Requirement: Wiki list page is a filterable card index

With no Wiki page selected, the Wiki page SHALL show a heading with the page count, the content filters plus the kind and text filters, and a responsive grid of Wiki page cards in the existing order. The desktop and mobile page rails SHALL NOT be rendered; a selected page keeps its reading surface, outline and quick switcher without a rail. An empty Wiki SHALL show the authoring empty copy.

#### Scenario: Searching the index
- **WHEN** the user types a tag into the text filter on `/<host>/<project>/wiki`
- **THEN** only matching Wiki page cards remain
