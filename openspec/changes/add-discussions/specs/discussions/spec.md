## Purpose

Provide file-backed research questions, owner feedback and agent acknowledgements with stable identities, rich context and a traceable decision history.

Implementation contract approved with the selected defaults in design.md.

## ADDED Requirements

### Requirement: Discussions are portable document bundles
A discussion SHALL use `docs/discussions/D<NNNN>-<slug>/README.md`, optional relative assets and one append-only `responses.jsonl`. Frontmatter SHALL contain title, discussion status and optional ordered categories. IDs SHALL be unique in the Project; creation SHALL allocate the next available padded ID without overwriting an existing bundle.

#### Scenario: Create a discussion
- **WHEN** an agent creates a discussion in a declared project
- **THEN** its bundle contains a titled README with status DRAFT and appears in the source catalog without entering user-facing discussion views

### Requirement: Discussions have an explicit preparation and closure lifecycle
Discussion status SHALL be DRAFT, OPEN or CLOSED, independent of question status. DRAFT SHALL mean agent preparation before user publication. OPEN SHALL admit user discussion. CLOSED SHALL retain readable history, including unfinished questions. Age, content changes and completion counts SHALL NOT assign stale/current or automatically change lifecycle. Explicit reopening SHALL preserve history.

#### Scenario: Agent prepares a draft
- **WHEN** a discussion is DRAFT while its agent is still preparing questions
- **THEN** agent CLI reads can inspect it while ordinary user-facing lists, waiting-for-you and share reads exclude its draft content and assets

#### Scenario: Close with unresolved questions
- **WHEN** a discussion is explicitly set to CLOSED while some questions are unanswered or deferred
- **THEN** the discussion remains CLOSED, the unresolved state and history remain readable, and closing acknowledges no feedback or question automatically

#### Scenario: Old discussion remains open
- **WHEN** an OPEN discussion has received no edits or answers for a long time
- **THEN** it remains OPEN with no stale label or automatic closure

#### Scenario: Reopen prior discussion
- **WHEN** a CLOSED discussion is explicitly changed to OPEN
- **THEN** its existing question identities, answers and unresolved work remain intact

### Requirement: Owner can close and reopen published discussions
The owner SHALL be able to change OPEN to CLOSED or CLOSED to OPEN from the browser under optimistic mtime-and-hash locking. Only status and affected catalog status/mtime SHALL change. DRAFT publication SHALL remain agent-authored. Closed unresolved questions SHALL remain intact; viewers SHALL NOT change lifecycle.

#### Scenario: Close from the discussion header
- **WHEN** the owner closes an OPEN discussion
- **THEN** its status and catalog become CLOSED, response controls disappear and all question/history bytes remain intact

### Requirement: User and agent define question categories freely
Question categories SHALL be free-form names chosen by the user and agent. Memon SHALL support grouping and filtering by those names without a built-in taxonomy or automatic assignment from type/status. Optional frontmatter categories SHALL define display order; undeclared categories SHALL still render afterward. Recategorization SHALL preserve question identity and history.

#### Scenario: Use a newly agreed category
- **WHEN** the user and agent place questions in a category absent from the frontmatter order
- **THEN** the category appears after ordered categories and its questions remain accessible through grouping and filters

#### Scenario: Move a question between categories
- **WHEN** an agent changes the category under the same stable question ID
- **THEN** the question moves to the chosen group and keeps its existing response thread

### Requirement: Question headings define exact source sections
A heading SHALL start a question when its first following block is a fenced `question` block. Its title SHALL be the heading text; its section SHALL end at the next same-or-higher heading. Nested subsections and fenced examples SHALL remain part of the body. Question IDs SHALL match `^[A-Z0-9][A-Z0-9-]{0,63}$`, be unique within the discussion and anchor as `#<ID>`.

#### Scenario: Nested prose
- **WHEN** a question description contains a lower-level heading and an example question fence
- **THEN** the subsection remains in that question and the example does not create an additional question

### Requirement: Question metadata has typed interactions
Types SHALL be `choice`, `multi`, `confirm` or `text`; category SHALL be a string. Options SHALL have unique IDs, labels and optional Markdown details. Optional preferences SHALL match the type and declared options. Stored status SHALL be OPEN, DECIDED, DEFERRED or DROPPED. DECIDED SHALL require a decision; rationale SHALL be optional. Only agents SHALL edit stored metadata.

#### Scenario: Invalid metadata
- **WHEN** a question has an invalid type, missing or duplicate ID, invalid preference or malformed YAML
- **THEN** refresh and show report its source line and the website renders an error card without silently hiding the section

### Requirement: Response history is append-only and typed
Owner responses SHALL carry a unique ID, question ID, local-offset timestamp, owner attribution, a section SHA-256 snapshot and a typed answer or nonempty comment. Agent acknowledgements SHALL reference a captured response ID. Agent replies SHALL identify their question. Events SHALL remain in append order; malformed lines SHALL be reported with line numbers rather than discarded silently.

#### Scenario: Follow-up feedback
- **WHEN** an owner answers a question twice and an agent replies
- **THEN** both answers and the reply remain visible in that question's history

### Requirement: Question status reflects unacknowledged and revised responses
Revision validity SHALL compare title, type, options, preference and description with the latest owner response. Category, status, decision and rationale changes SHALL NOT invalidate an answer. A validity difference SHALL display REVISED; otherwise pending feedback SHALL display ANSWERED, otherwise stored status. Exact section hashes SHALL remain separate for concurrency and history. An older response's ack SHALL NOT acknowledge newer feedback.

#### Scenario: Resolving feedback does not revise itself
- **WHEN** an agent resolves the latest response, writes DECIDED metadata and acknowledges the captured response
- **THEN** the question displays DECIDED until its section changes again or new feedback arrives

#### Scenario: Section revised after feedback
- **WHEN** the heading, options or description changes after the owner responds
- **THEN** the question displays REVISED and allows the owner to confirm the current version

#### Scenario: Concurrent new response
- **WHEN** an owner submits new feedback after an agent captures the responses to resolve
- **THEN** the new response remains unacknowledged and visible to pending-agent readers

### Requirement: Responses retain an honest revision comparison
The website SHALL offer the response's original section and current section when they differ. It SHALL locate matching section bytes in Git history first, and otherwise use a response's bounded section copy. When original bytes are unavailable or truncated it SHALL say so, without inventing a complete diff.

#### Scenario: Uncommitted question
- **WHEN** an owner answers a section that has no matching Git revision
- **THEN** the response stores a bounded fallback and later revision comparison labels any incomplete original

### Requirement: Catalogs power browser inventories
Refresh SHALL publish `.memon/index/discussions.json` with portable identities, titles, discussion lifecycle, category/question summaries and diagnostics. Browser lists and detail lookup SHALL read the catalog without recursive discovery. Missing, malformed, duplicate or escaping registrations SHALL return a repair error. A response append SHALL immediately update detail and pending-owner views without agent refresh.

#### Scenario: Missing inventory
- **WHEN** a declared Project has no discussion catalog
- **THEN** the page asks for source-side refresh rather than claiming there are no discussions

### Requirement: Agents can read and act on feedback through the CLI
The CLI SHALL provide discussion create/list/show/pending/resolve/reply/decisions. Show SHALL expose parsed questions, diagnostics, stored and derived states, and history in JSON by default. Resolve SHALL accept `D0001/<ID>`, rewrite only the target fence fields under mtime-and-hash locking, then append acknowledgements for captured unacknowledged responses. Failures between those writes SHALL be recoverable and reported honestly.

#### Scenario: Resolve without damaging prose
- **WHEN** an agent resolves a question as DECIDED with a decision and note
- **THEN** bytes outside its metadata fence remain identical and captured responses receive agent acknowledgements

#### Scenario: Conflicting edit
- **WHEN** the README changes after the agent reads it for resolve
- **THEN** resolution exits 9 and does not overwrite the concurrent edit

### Requirement: Browser cards preserve rich context in one column
Each question SHALL render one card in source order containing metadata, rich Markdown description, options and preference, answer controls and history. Description rendering SHALL support existing components, relative assets and trusted embedded HTML. Prose between questions SHALL render outside cards. DECIDED cards SHALL fold descriptions and show decision/rationale; REVISED cards SHALL expose a revision banner and comparison.

#### Scenario: Render research evidence
- **WHEN** a question includes a table, image and datatable or embed component
- **THEN** they render within its description using the discussion README's asset context

### Requirement: Overview and project views expose actionable questions
A discussion overview SHALL group questions by free-form category, filter by question status and jump to stable anchors while updating the URL. Project browsing SHALL default to OPEN discussions and provide CLOSED history filtering. Waiting-for-you SHALL include only OPEN and REVISED questions whose discussion is OPEN. A decision log SHALL retain published DECIDED questions and rationale.

#### Scenario: Navigate to a question
- **WHEN** a reader chooses a question in the overview
- **THEN** the card is reached and the URL contains its uppercase ID anchor

#### Scenario: Finished browsing excludes unpublished and closed work
- **WHEN** a reader opens waiting-for-you
- **THEN** no question from a DRAFT or CLOSED discussion appears, even if that question itself is OPEN

### Requirement: Discussions have a distinct visual identity
The Discussions sidebar entry and list heading SHALL use a paired-message icon distinct from the Reports document icon. The adjacent text SHALL remain the accessible label.

#### Scenario: Distinguish discussions from reports
- **WHEN** a reader scans the Project sidebar or opens the Discussions list
- **THEN** Discussions uses the same paired-message icon in both locations while Reports retains its document icon

### Requirement: Browser persists the last displayed discussion state
The browser SHALL store a bounded, versioned last-displayed baseline in localStorage, isolated by reader context, Host, Project and discussion. Later successful fetches SHALL compare against it before advancing it. First use SHALL initialize without marking every item changed. Failed fetches SHALL retain the baseline. Storage corruption or refusal SHALL fall back to memory without blocking the page.

#### Scenario: Page stays open while an agent updates content
- **WHEN** a later fetch returns a changed question or new reply
- **THEN** the browser compares it to the previously displayed baseline before saving the new displayed state

#### Scenario: Return after a reload
- **WHEN** a reader reopens the same discussion with a valid persisted baseline
- **THEN** the browser can distinguish content added or changed since its prior display

#### Scenario: Browser storage is unavailable
- **WHEN** localStorage throws or contains invalid state
- **THEN** discussion reading and responses continue using an in-memory comparison baseline

### Requirement: Fetched changes animate the affected content
New or changed fetched content SHALL receive a local update animation without resetting scroll, expanded cards or unsent form input. Identical fetches SHALL NOT replay animations. Reduced-motion users SHALL receive a static indicator. Animation SHALL remain independent of question revision/answer validity and discussion lifecycle.

#### Scenario: A new agent reply arrives
- **WHEN** a successful fetch adds one reply and leaves the other cards unchanged
- **THEN** the new reply is highlighted without flashing every card or clearing the reader's current answer

#### Scenario: Revalidation returns identical content
- **WHEN** the same semantic state is fetched again
- **THEN** no update animation repeats

### Requirement: Owner feedback and viewer reads have separate authority
Only the authenticated owner SHALL append responses to OPEN discussions. Whole-Project viewers SHALL read published OPEN/CLOSED discussions and assets without response controls. A changed question snapshot or no-longer-OPEN discussion SHALL reject an owner response with 409; invalid answers SHALL return 400. Responses SHALL NOT rewrite README or create journal receipts.

#### Scenario: Stale page
- **WHEN** the owner answers a question whose section changed since the page loaded
- **THEN** the API returns 409 and requests reloading the current question

#### Scenario: Discussion closed after page load
- **WHEN** an owner submits feedback after the discussion has been changed from OPEN to CLOSED
- **THEN** the API rejects the answer, preserves prior history and refreshes the displayed lifecycle rather than silently reopening the discussion

#### Scenario: Share viewer attempts a response
- **WHEN** a share viewer calls the response endpoint directly
- **THEN** the request is refused and the response log is unchanged
