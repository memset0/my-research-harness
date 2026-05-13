## ADDED Requirements

### Requirement: `SessionProvider` hydrates `{ role, scopeProjects }` on every page

The root layout (`apps/web/app/layout.tsx`) SHALL emit a server-side `<script id="memon-session" type="application/json">` block in `<head>` carrying the request's session shape:

```json
{
  "role": "owner" | "viewer" | "anon",
  "scopeProjects": ["project-a"]   // for viewer; empty array for owner/anon
}
```

The values SHALL be the SAME role/scope used by middleware for this request (server consults `req.role` / `req.scopeProjects` from the middleware-injected context). A client-side `SessionProvider` React context SHALL parse the JSON during initial hydration and expose `useSession()` returning `{ role, scopeProjects }`. The hook SHALL be SSR-safe (returns the hydrated value during server render).

#### Scenario: Owner session hydration
- **WHEN** an owner GETs `/p/project-a`
- **THEN** the response HTML contains `<script id="memon-session" type="application/json">{"role":"owner","scopeProjects":[]}</script>`
- **AND** `useSession()` returns `{ role: 'owner', scopeProjects: [] }` on first render

#### Scenario: Viewer session hydration
- **WHEN** a viewer scoped to project-a GETs `/p/project-a`
- **THEN** the script block reads `{"role":"viewer","scopeProjects":["project-a"]}`
- **AND** `useSession()` reflects that on first render

#### Scenario: Anonymous on /login
- **WHEN** an anonymous user GETs `/login`
- **THEN** the script block reads `{"role":"anon","scopeProjects":[]}`

### Requirement: `<ViewerGuard>` wrapper disables gated controls in viewer mode

A `<ViewerGuard>` wrapper component SHALL be available in `@/components/viewer-guard.tsx`. Usage:

```tsx
<ViewerGuard reason="Edit markdown">
  <Button onClick={...}>Edit markdown</Button>
</ViewerGuard>
```

When the active session is `viewer`, `ViewerGuard` SHALL:

- Clone its child and force `disabled={true}` AND `aria-disabled="true"`.
- Wrap in a shadcn `<Tooltip>` whose content reads: `Viewer mode — action disabled` (with the `reason` prop appended in parens if provided).
- Suppress `onClick` / `onPress` handlers so a click on the disabled control does nothing.

When the active session is `owner`, `ViewerGuard` SHALL render its child unchanged.

When the active session is `anon`, `ViewerGuard` SHALL render the child but force-disable it the same way as viewer (anon should not reach a page with gated controls in practice; this is defense-in-depth).

#### Scenario: Owner sees enabled control
- **WHEN** an owner views a page with `<ViewerGuard><Button>Edit</Button></ViewerGuard>`
- **THEN** the Button renders enabled with no tooltip wrapper

#### Scenario: Viewer sees disabled control with tooltip
- **WHEN** a viewer views the same page
- **THEN** the Button renders disabled with `aria-disabled="true"`
- **AND** hovering produces a tooltip reading `Viewer mode — action disabled (Edit markdown)`
- **AND** clicking does nothing (handler not invoked)

### Requirement: All mutating / shell controls wrapped in `<ViewerGuard>`

Every dashboard control whose action maps to a `mutating` or `shell` route SHALL be wrapped in `<ViewerGuard>` (or, equivalently, take a `disabled` prop driven by `useSession().role === 'viewer'`). The required wrap set is:

- `EditMarkdownButton` (`apps/web/components/edit-markdown-button.tsx`)
- `EditReadmeButton` (`apps/web/components/edit-readme-button.tsx`)
- `OpenClaudeCodeButton` (`apps/web/components/open-claude-code-button.tsx`)
- `AskClaudeCodeButton` (`apps/web/components/ask-claude-code-button.tsx`)
- `TerminalButton` (`apps/web/components/terminal-button.tsx`)
- `StatusEdit` (`apps/web/components/status-edit.tsx`)
- `AddNoteButton` (`apps/web/components/add-note-button.tsx`)
- `AddJournalEntryButton` (`apps/web/components/add-journal-entry-button.tsx`)
- All buttons in `/manage/tmux/tmux-page.client.tsx` (start / stop / attach / kill rows).
- All "Create experiment" / "Link" / "Unlink" / "Archive" affordances.
- All Warnings-table CRUD buttons (add / edit / delete rows).
- The "Manage share links" button itself (only owner can manage).
- The `OpenWithButton` split-button: its `Open Claude Code` and `Open browser terminal` tab options SHALL be disabled in viewer mode; the `Open in editor` (file system path copy) tab option MAY remain enabled since it does not call any API.

#### Scenario: Viewer page has every gated button disabled
- **WHEN** a viewer GETs `/p/project-a` (exp page, run page, hypotheses page, etc.)
- **THEN** every enumerated control above renders disabled with the appropriate tooltip
- **AND** none of the underlying API calls can be triggered from the UI

#### Scenario: Owner page is unchanged
- **WHEN** an owner GETs the same pages
- **THEN** every control renders enabled with no tooltip overlay (no behavior change from today)

### Requirement: Sidebar narrows to scope-set projects in viewer mode

The application sidebar (`apps/web/components/app-sidebar.tsx`) SHALL render different content for owner vs. viewer sessions:

- **Owner**: full project list (unchanged from today).
- **Viewer**: ONLY the projects listed in `useSession().scopeProjects`. The project switcher dropdown SHALL be replaced by a read-only label when `scopeProjects.length === 1`. Sidebar nav-items that are inherently project-scoped (Experiments, Hypotheses, Journal, Reports, Digests) SHALL link into the scope-set project; nav-items that aggregate across projects (e.g., a global "All anomalies" link) SHALL either be hidden OR filtered by scope.
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

### Requirement: Viewer-mode banner with "Log in as owner" link

A persistent banner using shadcn `<Alert>` SHALL appear at the top of every page when `useSession().role === 'viewer'`. The banner copy SHALL be:

```
Viewer mode — read-only access to <project-list>.
[Log in as owner] to access write actions.
```

The link points to `/login?next=<current-path>`. The banner SHALL be dismissible PER-SESSION (a state stored in `sessionStorage`) but SHALL re-appear on the next browser tab open.

#### Scenario: Banner appears for viewer
- **WHEN** a viewer with scope `["project-a"]` navigates to `/p/project-a`
- **THEN** the page renders an Alert banner at the top of the main content area reading "Viewer mode — read-only access to project-a. [Log in as owner]..."
- **AND** the [Log in as owner] is a link to `/login?next=/p/project-a`

#### Scenario: Banner absent for owner
- **WHEN** an owner navigates to any page
- **THEN** no viewer-mode banner appears

#### Scenario: Dismissed banner reappears in new tab
- **WHEN** the viewer dismisses the banner and opens a new tab
- **THEN** the banner reappears in the new tab (sessionStorage scope, not localStorage)

### Requirement: "Manage share links" dialog on the project page header

The project page header (`apps/web/app/p/[project]/layout.tsx` or the page itself) SHALL render an owner-only "Share" button. Clicking opens a shadcn `<Dialog>` containing:

- A `<Table>` listing existing shares: columns `Created`, `Label`, `Expires`, `Copy URL`, `Revoke`.
- An "Issue new share" form at the bottom: `<Input>` for label, optional expiry select (`30d`, `90d`, `never`), `<Button>` to create.
- On create, a toast (sonner) confirms creation AND auto-copies the URL to clipboard. The new row appears in the table without page reload.
- On revoke, a confirm prompt (shadcn `AlertDialog`), then the row disappears.
- All operations go through `/api/projects/<project>/shares` (GET / POST / DELETE) — see project-share spec.

The Share button SHALL render disabled (via `<ViewerGuard>`) in viewer mode — viewers cannot manage shares.

#### Scenario: Owner opens manage-shares dialog
- **WHEN** the owner clicks "Share" on `/p/project-a`
- **THEN** a Dialog opens showing the project's current shares (loaded via GET /api/projects/project-a/shares)

#### Scenario: Owner creates a new share
- **WHEN** the owner submits the "Issue new share" form with label "Reviewer"
- **THEN** POST /api/projects/project-a/shares is called; on success the dialog shows a new row, the share URL is copied to clipboard, and a toast confirms

#### Scenario: Owner revokes a share
- **WHEN** the owner clicks Revoke on a row and confirms in the AlertDialog
- **THEN** DELETE /api/projects/project-a/shares/<id> is called; on success the row disappears

#### Scenario: Viewer sees disabled Share button
- **WHEN** a viewer views `/p/project-a` (assuming they have scope for that project)
- **THEN** the "Share" button renders disabled with the viewer-mode tooltip

### Requirement: `/login` page renders a credential form for anon access

`GET /login` (anon-classed) SHALL render a centered shadcn `<Card>` with:
- A title `Sign in to memon`
- An `<Input name="username">` (default value `admin`, focused on load)
- An `<Input name="password" type="password">`
- A `<Button type="submit">Sign in</Button>`
- A small footer linking to `/api/auth/check` for diagnostics (NOT a visible link for normal users — visible via inspector for debugging)

The form SHALL POST to `/api/auth/login` with `application/x-www-form-urlencoded` body containing `username`, `password`, and optionally `next` (carried over from `?next=` query). On the response 302, the browser follows to the next URL. On failure, the page re-renders with an inline error message above the form.

The page SHALL display a small "Powered by memon" footer and SHALL look at home on small viewports (responsive, single-column layout, max-width ~24rem).

#### Scenario: Anon visits /login
- **WHEN** an anonymous browser GETs `/login` (no cookies)
- **THEN** the response is 200 with HTML containing the login form
- **AND** the username field is pre-filled `admin` and focused

#### Scenario: Login redirects to next
- **WHEN** an anon submits the form with valid credentials and the URL was `/login?next=/p/foo`
- **THEN** on success the response 302s to `/p/foo`
- **AND** the `memon-session` cookie is set

#### Scenario: Invalid password
- **WHEN** the form is submitted with a wrong password
- **THEN** the page re-renders with `Invalid credentials` shown above the form
- **AND** the username field is preserved; the password field is empty

#### Scenario: Login from viewer state
- **WHEN** a viewer-with-shares opens `/login` and submits valid credentials
- **THEN** the response 302s; the `memon-session` cookie is set; the `memon-shares` cookie is unchanged
- **AND** subsequent pages render in owner mode (banner gone, all controls enabled)

## MODIFIED Requirements

### Requirement: Project selector in top navigation

The dashboard SHALL display a project selector in the top navigation showing the projects from the active session's accessible set:

- For an **owner** session, the selector SHALL list all projects from the resolved `config.yml`.
- For a **viewer** session, the selector SHALL list ONLY projects in `useSession().scopeProjects`. If the scope contains exactly one project, the selector SHALL be replaced by a read-only `<span>` label naming the project. If the scope contains multiple projects, the selector renders a dropdown over those names.

Switching project (where applicable) SHALL update the experiment list, hypothesis view, journal view, reports inbox, and digests inbox to that project's data without full page reload, the same as today.

#### Scenario: Owner switching projects
- **WHEN** an owner clicks a different project in the selector
- **THEN** the URL updates with the project identifier and the views re-fetch data scoped to the new project

#### Scenario: Viewer with single-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a"]` opens the dashboard
- **THEN** the top-nav project label reads "project-a" as a plain `<span>` (no dropdown)
- **AND** there is no way to navigate to other projects from this surface

#### Scenario: Viewer with multi-project scope
- **WHEN** a viewer with `scopeProjects = ["project-a", "project-b"]` opens the dashboard
- **THEN** the selector dropdown lists the two scoped projects
- **AND** switching between them works as for owner
