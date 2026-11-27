# Spec Delta

## ADDED Requirements

### Requirement: A discussion states its shared goal
Discussion frontmatter SHALL accept an optional nonempty one-line `goal` string. The discussion itself SHALL be the unit of shared goal; no separate goal entity, directory or identifier SHALL be introduced. Categories SHALL remain the grouping for sub-topics. The website SHALL show the goal under the discussion title, and its absence SHALL change nothing else.

#### Scenario: Discussion with a goal
- **WHEN** a discussion's frontmatter sets `goal: Replace the polling scheduler without downtime`
- **THEN** the discussion page shows that sentence under its title and the list row shows it as the row description

#### Scenario: Discussion without a goal
- **WHEN** a discussion omits `goal`
- **THEN** it renders, refreshes and accepts responses exactly as before

### Requirement: Questions track implementation separately from decision
Each question SHALL accept optional `work: TODO | DOING | DONE | SKIP`, independent of stored `status`. Absent `work` SHALL mean TODO. SKIP SHALL mean settled with nothing to implement. Only agents SHALL write `work`. DOING or DONE on a question that is not settled SHALL be reported as a diagnostic while the question still renders.

#### Scenario: Decided but not built
- **WHEN** a question is DECIDED and has no `work` field
- **THEN** it displays as settled and awaiting work, not as complete

#### Scenario: Work marked before a decision
- **WHEN** an OPEN choice question carries `work: DONE`
- **THEN** refresh and show report a diagnostic with its source line and the question does not count as complete

### Requirement: Settled questions record who decided them
A DECIDED question SHALL accept optional `decided_by: owner | agent`. Agent-decided questions SHALL count as settled immediately and SHALL be labelled as agent-decided. An owner response to an agent-decided question SHALL follow the existing pending-feedback flow so the owner can overturn the decision. An absent `decided_by` SHALL display no attribution.

#### Scenario: Agent settles a detail for the owner
- **WHEN** an agent resolves a question as DECIDED with `decided_by: agent` and no owner response
- **THEN** the card shows an agent-decided label, the progress counts it as settled, and the answer form remains available to the owner

#### Scenario: Owner overturns an agent decision
- **WHEN** the owner answers an agent-decided question differently
- **THEN** the question displays ANSWERED and appears in agent pending output until the agent processes it

### Requirement: Subgoals are comment-only work units
In addition to choice, multi, confirm and text, a question SHALL accept `type: subgoal`. A subgoal SHALL have no options, preference or decision. Its stored status SHALL be OPEN, DEFERRED or DROPPED, and it SHALL count as settled from creation. Owners SHALL be able to comment on a subgoal. Typed answers to a subgoal SHALL be rejected with 400. Agents SHALL acknowledge and reply to subgoals exactly as they do for other questions.

#### Scenario: Owner annotates a subgoal
- **WHEN** the owner submits a comment on an OPEN subgoal in an OPEN discussion
- **THEN** the comment is appended, the subgoal displays ANSWERED until acknowledged, and its `work` state is unchanged

#### Scenario: Subgoal completion advances progress
- **WHEN** an agent sets a subgoal's `work` to DONE
- **THEN** the discussion's completed count increases by one without any owner answer

#### Scenario: Invalid subgoal metadata
- **WHEN** a subgoal declares options, a preference, a decision or status DECIDED
- **THEN** refresh and show report a diagnostic with its source line and the website renders an error card

### Requirement: Questions cite Reports
A question SHALL accept optional `refs`: a list of Report IDs (`R<NNNN>`), each optionally followed by `#<heading-anchor>`. A card SHALL show one badge per cited Report and anchor. Relative Markdown links that resolve to a registered Report bundle SHALL also count as references when they appear in question descriptions or agent replies. The same Report MAY be cited any number of times. A ref to an unregistered Report SHALL be reported as a diagnostic.

#### Scenario: Structured references render as badges
- **WHEN** a question lists `refs: [R0012, R0014#benchmarks]` and both Reports are registered
- **THEN** its card shows two badges with the Report titles, each linking to the Report, the second linking to the `benchmarks` heading

#### Scenario: Reference to a missing Report
- **WHEN** a question lists `refs: [R0099]` and no such Report is registered
- **THEN** refresh reports a diagnostic and the card shows a warning badge rather than a broken link

#### Scenario: Agent reply cites a Report
- **WHEN** an agent reply's text contains a relative Markdown link to a registered Report bundle
- **THEN** the link renders normally and the Report lists that question among its references

### Requirement: Reports list the discussions that cite them
Refresh SHALL publish each question's resolved Report references in `discussions.json`. A Report page SHALL list the OPEN and CLOSED discussions and the question titles that reference it, linking to each question's anchor. DRAFT discussions SHALL NOT appear. The list SHALL be shown only to the owner and to whole-Project viewers.

#### Scenario: Report cited from two discussions
- **WHEN** questions in D0002 and D0005 both reference R0012
- **THEN** the R0012 page lists both questions under their discussions with links to `/d/<n>#<ID>`

#### Scenario: Citation from a draft
- **WHEN** only a DRAFT discussion references a Report
- **THEN** the Report page shows no discussion references

#### Scenario: Document-scoped viewer
- **WHEN** a viewer whose grant covers only that Report opens it
- **THEN** no discussion references are shown

### Requirement: Discussions show two-axis progress
A discussion SHALL derive progress over its countable units: every question except DROPPED and DEFERRED. The progress SHALL partition those units into completed (`work` DONE or SKIP), settled awaiting work, waiting for the owner, awaiting an agent response, and other unsettled. A unit SHALL be settled when it is DECIDED or a subgoal. DEFERRED units SHALL be shown beside the progress, not counted.

#### Scenario: Mixed discussion
- **WHEN** a discussion has 2 DONE questions, 1 DECIDED question with TODO work, 1 subgoal with DOING work, 1 OPEN question with no response, 1 ANSWERED question and 1 DROPPED question
- **THEN** progress reads 6 counted units: 2 completed, 2 settled awaiting work, 1 waiting for the owner and 1 awaiting the agent, with settled 4/6 and completed 2/6

#### Scenario: Owner response arrives
- **WHEN** the owner answers the only question waiting for them
- **THEN** after the response is accepted, that unit moves from waiting for the owner to awaiting the agent without an agent refresh

### Requirement: Browser renders progress compactly
The discussion header SHALL show two progress bars, settled and completed, each with its count, plus a text summary of the remaining buckets. Each list row SHALL show the same counts compactly, and the waiting-for-owner count SHALL be the most prominent. The question overview SHALL let readers filter by work state. Cards SHALL show work, decider and reference badges. Owners SHALL NOT edit `work` from the browser.

#### Scenario: Read progress at a glance
- **WHEN** the owner opens a discussion page on desktop or a 390px viewport
- **THEN** the header shows the settled and completed bars with their counts and the remaining-bucket summary without overflow, built from existing shadcn primitives

#### Scenario: Filter to unfinished work
- **WHEN** a reader selects the "awaiting work" filter in the overview
- **THEN** only settled units whose work is TODO or DOING are highlighted and linked

### Requirement: Agents update work and review outstanding work through the CLI
The CLI SHALL provide `discussion work <D>/<ID> <TODO|DOING|DONE|SKIP>`, which rewrites only that question's `work` field under mtime-and-hash locking and refuses invalid states. `discussion todo` SHALL list settled, incomplete units in OPEN discussions. `discussion resolve` SHALL accept `--work` and `--by`; without `--by` it SHALL record `owner` when it acknowledges owner responses and `agent` otherwise. `discussion show` SHALL include progress counts.

#### Scenario: Mark work done
- **WHEN** an agent runs `memon discussion work D0003/CACHE-LAYER DONE` on a DECIDED question
- **THEN** only the `work` value in that fence changes, all other bytes remain identical, and the next show reports the unit as completed

#### Scenario: Conflicting edit
- **WHEN** the README changes after the agent reads it for a work update
- **THEN** the command exits 9 and does not overwrite the concurrent edit

#### Scenario: Resolve without owner input
- **WHEN** an agent resolves a question with no pending owner response and does not pass `--by`
- **THEN** the question is written with `decided_by: agent`

### Requirement: Goal-progress fields stay within FS convention 12
The goal, work, decider and reference fields SHALL be optional, and existing discussions SHALL remain valid without them. The response event log format SHALL NOT change. Introducing these fields SHALL NOT change the FS convention marker or migrate project data.

#### Scenario: Existing discussion after upgrade
- **WHEN** a discussion written before this change is refreshed by the new CLI
- **THEN** it produces no new diagnostics, and its DECIDED questions count as settled awaiting work
