## MODIFIED Requirements

### Requirement: Share dialog offers page links and public pages
The share dialog SHALL copy links in the page-URL form, SHALL offer "Make public" on Report and Wiki pages (and show when the current page already is public), and SHALL list public pages distinctly from token links. Copying a listed Project-scoped token link SHALL produce the URL of the page currently open (its path and query without any existing `share` parameter, and without a fragment) with `share=<token>` appended; document-scoped token links and public pages SHALL copy their own record link.

#### Scenario: Make the current Report public
- **WHEN** the owner on `R0005` chooses "Make public"
- **THEN** the page URL is copied and the list shows "Public · Report R0005"

#### Scenario: Copy a whole-Project link from another page
- **WHEN** a whole-Project link was issued from the Project root and the owner copies it while on `/h/<host>/p/<project>/reports/R0006?expanded=1`
- **THEN** the copied URL is `/h/<host>/p/<project>/reports/R0006?expanded=1&share=<token>` on the public origin

#### Scenario: Copy a page link from another page
- **WHEN** the owner copies a link scoped to `W0004` while on `R0006`
- **THEN** the copied URL is the `W0004` page URL with `share=<token>`
