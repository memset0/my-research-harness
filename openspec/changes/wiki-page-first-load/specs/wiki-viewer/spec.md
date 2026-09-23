## ADDED Requirements

### Requirement: Reading surface loads independently of the rail

When a page is selected, its reading surface SHALL render as soon as that page's own data is available, whether or not the rail's page list has loaded. The page request and the list request SHALL be issued independently, and a server-rendered wiki page route SHALL NOT delay the response on the list; the rail SHALL show its loading state until its list arrives.

#### Scenario: Slow list does not hide the page
- **GIVEN** the wiki list takes longer to load than the selected page
- **WHEN** the user opens `/p/<project>/wiki/W0004` or `/h/<host>/p/<project>/wiki/W0004`
- **THEN** the page body renders while the rail still shows its loading skeleton
- **AND** the rail fills in when the list arrives
