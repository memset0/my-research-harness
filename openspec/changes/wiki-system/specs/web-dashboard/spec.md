## ADDED Requirements

### Requirement: Wiki bundle pages reuse the Report HTML embed behavior

A bundle-form wiki page SHALL reuse the Report HTML embed behavior already specified by this capability, with `/api/wiki-assets/<project>/<W-id>/<...path>` as the resolved same-origin asset route. Concretely, when the shared Markdown renderer encounters the local `.html`/`.htm` image syntax inside a wiki bundle page, the resulting embed SHALL behave exactly as the requirements "Embedded Report HTML uses a responsive, recoverable iframe wrapper", "Report HTML embeds share stepped zoom controls", "Report HTML embeds expose controlled reload and change awareness", "Report HTML expanded mode remains inside the page", and "Mobile Report iframe actions use a compact overflow menu" specify for Reports: the responsive wrapper with loading, error, Retry, Open in new tab and page-internal Expand states; the shared 10-point stepped zoom per rendered surface; the manual Reload with its low-frequency header-only revision check and update indicator; page-internal expanded mode covering the whole application viewport from a full-page route, right split, or drawer; and the sub-`sm` three-dot overflow menu with its in-menu zoom stepper.

No separate wiki embed component, sizing model, or trust model SHALL be introduced: the same-origin unsandboxed iframe, the absence of a manifest, and server-side bundle path confinement carry over unchanged, now enforced by the wiki asset route. Single-file wiki pages have no resource base URL and SHALL render without an iframe.

#### Scenario: Wiki bundle embed behaves like a Report embed
- **GIVEN** a wiki bundle README containing `![Training curves](./views/loss-curves/index.html)`
- **WHEN** the wiki page renders
- **THEN** the embed uses the same wrapper with its loading, error, Retry, Open in new tab, Reload, zoom, and Expand behavior as an equivalent Report embed
- **AND** its iframe and every action resolve `/api/wiki-assets/<project>/<W-id>/views/loss-curves/index.html` without a `sandbox` attribute

#### Scenario: Wiki asset route is the only difference
- **GIVEN** the same HTML view is embedded once from a Report bundle and once from a wiki bundle page
- **WHEN** both surfaces render at a mobile width and at a desktop width
- **THEN** their toolbars, overflow menus, zoom percentages, and expanded-mode coverage are identical
- **AND** only the resolved asset URL differs, using `/api/report-assets/...` for the Report and `/api/wiki-assets/...` for the wiki page

## MODIFIED Requirements

### Requirement: Sidebar narrows to scope-set projects in viewer mode

The application sidebar (`apps/web/components/app-sidebar.tsx`) SHALL render different content for owner vs. viewer sessions:

- **Owner**: full project list (unchanged from today).
- **Viewer**: ONLY the projects listed in `useSession().scopeProjects`. The project switcher dropdown SHALL be replaced by a read-only label when `scopeProjects.length === 1`. Sidebar nav-items that are inherently project-scoped (Experiments, Hypotheses, Journal, Reports, Wiki, Digests) SHALL link into the scope-set project; nav-items that aggregate across projects (e.g., a global "All anomalies" link) SHALL either be hidden OR filtered by scope.
- **Anon**: sidebar SHALL be hidden or replaced by the login-page chrome only.

#### Scenario: Viewer with single-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a"]` opens the dashboard
- **THEN** the sidebar shows only "project-a" entries
- **AND** the project switcher is replaced by a `<span>project-a</span>` label

#### Scenario: Viewer with multi-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a", "project-b"]` opens the dashboard
- **THEN** the sidebar shows project entries for both projects
- **AND** the project switcher dropdown is present, populated with the two

#### Scenario: Viewer aggregate links hidden
- **WHEN** a viewer is on any page
- **THEN** the sidebar does NOT show a "Manage tmux" link (the manage page is shell-classed)
- **AND** it does NOT show a "Settings" link (settings is owner-only mutating)
- **AND** it does NOT show the Slurm status widget (the `slurm-status` capability is owner-only; the widget is gated on `role !== 'viewer'` in the same conditional block that gates Manage tmux)

#### Scenario: Viewer project nav lists both Reports and Wiki
- **WHEN** a viewer with `scopeProjects = ["project-a"]` opens the dashboard
- **THEN** the project-scoped nav items include both `Reports` and `Wiki`, each linking into `project-a`
- **AND** the wiki entry is read-only: no review or edit action is offered

### Requirement: Lazy iframe timeout begins near the viewport

A successfully probed Report or wiki-page iframe SHALL remain lazy-loaded. In browsers with IntersectionObserver, its bounded post-probe load timeout SHALL begin only when the wrapper enters a configured proximity margin around the viewport. A below-fold iframe SHALL remain mounted while deferred and SHALL not enter an error state merely because the timeout duration elapsed before it approached the viewport. Browsers without IntersectionObserver MAY start the timer immediately for compatibility.

#### Scenario: Later plots are not failed while below the fold
- **GIVEN** one Report contains multiple lazy iframe plots and a later plot is outside the viewport proximity margin
- **WHEN** more than the normal load-timeout duration elapses before the user scrolls to it
- **THEN** the later iframe remains mounted in its loading state
- **WHEN** it approaches the viewport
- **THEN** its bounded load timer begins and normal load/error handling resumes

#### Scenario: Wiki bundle plots defer the same way
- **GIVEN** a wiki bundle page contains multiple lazy iframe plots and a later plot is below the fold
- **WHEN** more than the normal load-timeout duration elapses
- **THEN** the deferred wiki iframe remains in its loading state instead of failing
- **AND** its timer begins when it approaches the viewport

### Requirement: Central navigation is Host-qualified
Every central Project, run, Experiment, report, wiki, code-review, inbox, Git, terminal, and management link/action SHALL preserve the selected Host and Project. Equal names/IDs on two Hosts SHALL produce distinct links and state. Standalone routes SHALL remain project-only.

#### Scenario: Equal Project names open distinct pages
- **WHEN** two Hosts expose `project-x`
- **THEN** selecting each entry navigates to a different `/h/<host>/p/project-x/...` route and loads only that Host

#### Scenario: Host-qualified wiki links keep their Host
- **WHEN** a central wiki page link is activated from a Host-qualified Project page
- **THEN** the destination stays under `/h/<host>/p/<project>/wiki/...` and resolves against that Host's Backend
- **AND** an equally-numbered page on another Host is not loaded
