## MODIFIED Requirements

### Requirement: Experiment-card grid as the project list page

The list page at `/<host>/<project>` (and its equal alias
`/<host>/<project>/experiments`) SHALL render a responsive grid of
experiment cards (one card per experiment). Each card SHALL contain:

1. **Header row**: experiment status pill (rendering the manual `frontMatter.status` of the exp doc per `experiment-readme`'s `ExperimentStatus` enum), exp id + slug in monospace, and an `Archive` icon prefix when `archived: true` per `archive-frontmatter`'s visual treatment.
2. **Title line**: the exp's `title` field rendered in a slightly larger weight.
3. **Secondary line under the title**: a small muted-text run-roster summary in the form `<n> running · <n> done · <n> interrupted · <n> failed · <n> pending` (categories with zero count omitted; `<n> unparseable` appended only when non-zero). When the experiment has zero member runs, the line reads `no runs yet`. The total count is implicit (sum of the parts) — there is NO separate `<finished> / <total>` counter.
4. **Embedded runs table**: one row per confirmed member run, columns
   `status pill | run dir name | created_at HH:MM | duration-or-status
   | files-count`. Clicking a row navigates to
   `/<host>/<project>/e/<n>?run=<run-dir>` (`<n>` is the Experiment
   number without leading zeros or slug) with that run panel
   auto-expanded. Archived runs in this table SHALL render with the desaturated treatment from `archive-frontmatter` and an `Archive` icon prefix.
5. **Footer left**: tags as outline badges (the exp's frontmatter
   `tags[]`).
6. **Footer right (desktop)**: 📅 `effective_created_at` and ✎
   `effective_updated_at`, each preceded by a small icon.
7. **Footer (mobile)**: tags and times stack vertically.

The card pill SHALL NOT compute aggregate from member-run statuses. Run aggregation continues to exist as a derived stat (used by the secondary line above and by the agent-handoff prompt) but does NOT drive the card pill.

Cards SHALL be sorted by `effective_updated_at` descending by default (active items first when checkbox unchecked, per `archive-frontmatter`'s listing rules); the sort/filter controls from the v2 list view (a flexible header) are re-used to control sort key and search across exp title / slug / tags / member-run names.

The "Show archived" checkbox and bottom-of-list bucket affordance live above and below this grid per `archive-frontmatter`'s "Frontend listing has two display modes for archived items" requirement. Archived cards' visual treatment follows `archive-frontmatter`'s "Visual treatment of archived items."

There SHALL NOT be a sub-project badge on cards (the sub-project field
is gone in v3).

#### Scenario: Card header shows manual status, not aggregate
- **GIVEN** an experiment with `frontMatter.status: OPEN` and 3 confirmed runs whose statuses are RUNNING, FINISHED, FINISHED
- **WHEN** the card renders
- **THEN** the header status pill is `OPEN` (sky-blue `CircleDot`), driven by the manual frontmatter value
- **AND** the secondary line under the title reads `1 running · 2 done`
- **AND** there is NO separate `<n> / <m>` counter badge in the header

#### Scenario: Card pill reflects RESOLVED even with all-FINISHED runs
- **GIVEN** an experiment with `frontMatter.status: RESOLVED` and 5 member runs all `FINISHED`
- **WHEN** the card renders
- **THEN** the pill is `RESOLVED` (emerald `CheckCircle2`)
- **AND** the secondary line reads `5 done`

#### Scenario: Card pill reflects ABANDONED with mixed runs
- **GIVEN** an experiment with `frontMatter.status: ABANDONED` and 4 member runs (2 FINISHED, 1 FAILED, 1 INTERRUPTED)
- **WHEN** the card renders
- **THEN** the pill is `ABANDONED` (stone-gray `XCircle`)
- **AND** the secondary line reads `2 done · 1 interrupted · 1 failed`

#### Scenario: Embedded runs table row click navigates with auto-expand
- **WHEN** the user clicks a row inside an experiment card
- **THEN** the URL becomes `/<host>/<project>/e/<n>?run=<run-dir>` and
  the corresponding run panel is expanded on the destination page

#### Scenario: Empty experiment renders an empty runs table
- **GIVEN** an experiment with `runs: []` (zero member runs)
- **WHEN** the card renders
- **THEN** the runs table area shows an empty-state message stating there are no runs yet
- **AND** the secondary line under the title reads `no runs yet`
- **AND** the card pill renders the manual `status` (typically `OPEN`)
- **AND** tag/time footers still render normally

#### Scenario: Archived experiment card uses desaturated treatment
- **GIVEN** an experiment with `archived: true, status: RESOLVED`
- **WHEN** the card renders (whether checkbox-checked, in the segregated bucket, or anywhere)
- **THEN** the card outer wrapper has the `opacity-60` (or equivalent) overlay
- **AND** the status pill has an `Archive` icon prefix and a desaturated emerald variant
- **AND** the wrapper's `aria-label` contains the word `archived`

#### Scenario: Default unchecked grid hides archived items
- **GIVEN** a project with 5 active and 2 archived experiments
- **WHEN** the user navigates to `/<host>/<project>` for the first time (checkbox unchecked, no reveal)
- **THEN** the grid renders 5 cards
- **AND** below the grid a single line reads `Show 2 archived experiments`
- **AND** the 2 archived experiments are not in the DOM

#### Scenario: Checkbox checked interleaves archived and active
- **GIVEN** the same project
- **WHEN** the user ticks "Show archived"
- **THEN** the grid renders 7 cards in a single sort by `effective_updated_at` desc
- **AND** archived cards intermix with active cards in their natural sort position
- **AND** archived cards retain the desaturated treatment + Archive icon

### Requirement: Experiment-doc detail page (v3)

The route `/<host>/<project>/e/<n>`, where `<n>` is the Experiment number
without leading zeros and without a slug, SHALL render an experiment detail
page with this layout:
- **Header bar**: title, aggregate status pill, effective times, tags,
  hypothesis-ref chips
- **Action bar**: `Edit markdown` opens the editor on the Experiment document.
- **Body markdown**: rendered `Motivation` / `Method` / `Plan` /
  `Conclusion` / `Caveats` / `Warnings` (in this order; the warnings
  table renders inline with the Run column)
- **Runs section header**: `Runs (<count>)`
- **Run panels**: one expandable panel per confirmed member run

The `Plan` section SHALL render as a Card (parallel to the other body
sections) using the same markdown renderer. The renderer SHALL display
GFM task list markers (`- [ ]` / `- [x]`, `* [ ]` / `* [x]` synonyms
also accepted) as native HTML checkboxes (`<input type="checkbox">`)
at every nesting depth supported by GFM. Checkboxes SHALL render in
the **disabled** state in v1 — clicking them SHALL NOT toggle their
state and SHALL NOT issue any network request. Toggling Plan items is
done via the existing `Edit markdown` dialog.

When the `Plan` section body is null/empty, the Card SHALL render a
placeholder (consistent with how other empty body sections are
rendered today) so the user sees that the section exists and is
editable.

Run panels SHALL be expanded by default (per the design discussion's
Q13 decision). The set of expanded panels SHALL be persisted in URL
hash and `localStorage` (key `memon:exp-page:<exp-id>:expanded`) so a
reload preserves the user's most-recent toggle state.

When the URL has `?run=<run-dir>`, that run's panel SHALL be expanded
on initial render and the page SHALL scroll to it.

#### Scenario: All run panels open by default on first visit
- **GIVEN** an experiment with 3 confirmed runs and no prior
  `localStorage` toggle state
- **WHEN** the user opens the exp detail page
- **THEN** all 3 run panels are rendered expanded

#### Scenario: ?run= query param expands and scrolls
- **GIVEN** the same experiment
- **WHEN** the URL is `/<host>/<project>/e/<n>?run=run-2`
- **THEN** all 3 panels are expanded; the page scrolls to `run-2`'s
  panel

#### Scenario: Toggled-collapse persists across reload
- **GIVEN** the user collapsed the panel for `run-1`
- **WHEN** the user reloads the page
- **THEN** `run-1` is still collapsed; the others are still expanded

#### Scenario: Plan section renders nested task list with read-only checkboxes
- **GIVEN** an experiment doc whose `## Plan` body is:
  ```
  - [x] Run baseline at LR=1e-4
    - converged but loss plateaued early
  - [ ] Try LR=3e-4 + warmup
    - [ ] Sweep batch size [32, 64, 128]
  ```
- **WHEN** the user opens the exp detail page
- **THEN** the Plan Card renders three `<input type="checkbox">`
  elements, the first checked and all three with the `disabled`
  attribute set; the nested list visually indents the inner items;
  the reflection text under the first task renders as a sub-bullet

#### Scenario: Click on rendered checkbox is a no-op
- **GIVEN** the Plan Card rendered as in the previous scenario
- **WHEN** the user clicks the unchecked checkbox next to "Try LR=3e-4
  + warmup"
- **THEN** the checkbox state does not change, no network request is
  issued, and the only path to toggle is through the `Edit markdown`
  dialog

#### Scenario: Plan Card renders placeholder when section is empty
- **GIVEN** an experiment doc whose `## Plan` section is absent or
  whose body is empty
- **WHEN** the user opens the exp detail page
- **THEN** the Plan Card renders the same empty-section placeholder
  treatment as `Method` / `Conclusion` / `Caveats` show today when
  empty

### Requirement: Exp card title navigates to the detail page

The card title SHALL be rendered as a Link that navigates to the exp detail page (`/<host>/<project>/e/<n>`) — the same URL the existing E-id link points at — so clicking the title text takes the user to the detail page. The title link SHALL carry `hover:underline` for the standard click affordance. The E-id link remains a separate Link so the monospace id keeps its canonical visual treatment.

#### Scenario: Click on title navigates
- **GIVEN** a project with at least one exp doc whose title is `vpred convergence`
- **WHEN** the user clicks anywhere on the rendered title text
- **THEN** the browser navigates to `/<host>/<project>/e/<n>` (the same URL the E-id link points at)

#### Scenario: Title shows hover affordance
- **WHEN** the user hovers the title text
- **THEN** the text shows the underline affordance (the link is rendered with the `hover:underline` Tailwind utility)

### Requirement: Viewer-mode banner with "Log in as owner" link

A persistent banner using shadcn `<Alert>` SHALL appear at the top of every page when `useSession().role === 'viewer'`. The banner copy SHALL be:

```
Viewer mode — read-only access to <project-list>.
[Log in as owner] to access write actions.
```

The link points to `/login?next=<current-path>`. The banner SHALL be dismissible PER-SESSION (a state stored in `sessionStorage`) but SHALL re-appear on the next browser tab open.

#### Scenario: Banner appears for viewer
- **WHEN** a viewer with scope `["project-a"]` navigates to `/host-a/project-a`
- **THEN** the page renders an Alert banner at the top of the main content area reading "Viewer mode — read-only access to project-a. [Log in as owner]..."
- **AND** the [Log in as owner] is a link to `/login?next=/host-a/project-a`

#### Scenario: Banner absent for owner
- **WHEN** an owner navigates to any page
- **THEN** no viewer-mode banner appears

#### Scenario: Dismissed banner reappears in new tab
- **WHEN** the viewer dismisses the banner and opens a new tab
- **THEN** the banner reappears in the new tab (sessionStorage scope, not localStorage)

### Requirement: "Manage share links" dialog on the project page header

The header of every canonical project page under `/<host>/<project>` (the shared project layout or the page itself) SHALL render an owner-only "Share" button. Clicking opens a shadcn `<Dialog>` containing:

- A `<Table>` listing existing shares: columns `Created`, `Label`, `Expires`, `Copy URL`, `Revoke`.
- An "Issue new share" form at the bottom: `<Input>` for label, optional expiry select (`30d`, `90d`, `never`), `<Button>` to create.
- On create, a toast (sonner) confirms creation AND auto-copies the URL to clipboard. The new row appears in the table without page reload.
- On revoke, a confirm prompt (shadcn `AlertDialog`), then the row disappears.
- All operations go through the owner share API at `/api/shares`, scoped to the page's Host and Project: `GET /api/shares?host=<host>&project=<project>`, `POST /api/shares` with `{host, project, …}`, and `DELETE /api/shares/<id>` — see project-share spec.

The Share button SHALL render disabled (via `<ViewerGuard>`) in viewer mode — viewers cannot manage shares.

#### Scenario: Owner opens manage-shares dialog
- **WHEN** the owner clicks "Share" on `/host-a/project-a`
- **THEN** a Dialog opens showing the project's current shares (loaded via GET /api/shares?host=host-a&project=project-a)

#### Scenario: Owner creates a new share
- **WHEN** the owner submits the "Issue new share" form with label "Reviewer"
- **THEN** POST /api/shares with `host: host-a` and `project: project-a` is called; on success the dialog shows a new row, the share URL is copied to clipboard, and a toast confirms

#### Scenario: Owner revokes a share
- **WHEN** the owner clicks Revoke on a row and confirms in the AlertDialog
- **THEN** DELETE /api/shares/<id> is called; on success the row disappears

#### Scenario: Viewer sees disabled Share button
- **WHEN** a viewer views `/host-a/project-a` (assuming they have scope for that project)
- **THEN** the "Share" button renders disabled with the viewer-mode tooltip

### Requirement: Code-review surface in project navigation

The per-project navigation SHALL include a "Code review" entry that links to
`/<host>/<project>/code-review`, shown alongside the existing experiments /
journal / reports / wiki surfaces and marked active when the current path is
the code-review list or a review detail route. The detail routes
`/<host>/<project>/cr/<date>-<slug>` (project review) and
`/<host>/<project>/e/<n>/cr/<date>-<slug>` (Experiment review) SHALL be
reachable both from that list and from the experiment detail page's
associated-reviews panel.

#### Scenario: Nav entry present and active
- **WHEN** the user is on `/<host>/<project>/code-review`, `/<host>/<project>/cr/<date>-<slug>` or `/<host>/<project>/e/<n>/cr/<date>-<slug>`
- **THEN** the navigation shows a "Code review" entry in the active state

#### Scenario: Deep link resolves
- **WHEN** the user opens `/host-a/project-a/e/42/cr/2026-05-24-foo` directly
- **THEN** the detail page renders that doc (subject to auth)

### Requirement: Central navigation is Host-qualified
Every central Project, run, Experiment, report, wiki, code-review, inbox, Git, terminal, and management link/action SHALL preserve the selected Host and Project. Equal names/IDs on two Hosts SHALL produce distinct links and state. Project page links SHALL use the canonical `/<host>/<project>/…` paths; there are no project-only page routes.

#### Scenario: Equal Project names open distinct pages
- **WHEN** two Hosts expose `project-x`
- **THEN** selecting each entry navigates to a different `/<host>/project-x/...` route and loads only that Host

#### Scenario: Host-qualified wiki links keep their Host
- **WHEN** a central wiki page link is activated from a Host-qualified Project page
- **THEN** the destination stays under `/<host>/<project>/w/<n>` and resolves against that configured Host-qualified project's central service
- **AND** an equally-numbered page on another Host is not loaded

### Requirement: Central mode never guesses an omitted Host
The UI SHALL NOT issue a Project/resource mutation without an exact Host selector. Hostless project-only page URLs (`/p/<project>/…`) are retired: they SHALL return 404 and SHALL NOT be redirected or resolved to any Host, even when only one Host exposes that Project name.

#### Scenario: Ambiguous legacy detail link is safe
- **WHEN** a browser opens a project-only detail link such as `/p/project-x/e/E0001-foo` while two Hosts expose `project-x`
- **THEN** the response is a 404 and no resource of either Host is loaded or mutated

## REMOVED Requirements

### Requirement: URL redirects from legacy run paths
**Reason**: Hostless `/p/<project>/…` URLs, including `/p/<project>/r/<run-dir>` and `/p/<project>/experiments/<run-dir>`, are retired and return 404 (page-routes); a hostless path cannot name a Host, and `/r/<n>` is now the canonical Report route.
**Migration**: Link a Run through its Experiment page with the unchanged query parameter, `/<host>/<project>/e/<n>?run=<run-dir>`. Old bookmarks of the hostless run forms must be re-created from the Host-qualified Experiment page.
