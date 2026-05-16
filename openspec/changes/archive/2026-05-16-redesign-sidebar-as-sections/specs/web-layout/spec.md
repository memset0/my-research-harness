## ADDED Requirements

### Requirement: Sidebar sections use a VSCode-Explorer-style banner header

Each project group's collapsible header in the sidebar SHALL render
as a single horizontal banner row whose visual identity comes from
its **own background and dividers**, NOT from any expand/collapse
indicator icon. There SHALL be NO chevron, arrow, or similar
glyph in the header; the banner contrast IS the affordance that
distinguishes one project from the next and signals interactivity.

The banner styling on the `<SidebarGroupLabel>` SHALL include, at
minimum, all of:

- A **fixed banner height** of `h-7` (1.75rem = 28px). The height is
  fixed (NOT `h-auto`) so it matches the outer grid-row template's
  `minmax(1.75rem, …)` minimum exactly — closed rows pin at banner
  height with no overflow, and banners NEVER compress when sibling
  sections expand.
- A **tinted background** of `bg-sidebar-accent/60` that visually
  separates the header from the surrounding project body and from
  adjacent sections. (Iterated post-apply: the earlier `/40`
  rendered too pale against the new resting layout; the owner
  requested deeper contrast.)
- A **1px top border AND 1px bottom border** in
  `var(--sidebar-border)` (e.g. `border-y border-sidebar-border`).
- A **hover state** that brightens the background (e.g.
  `hover:bg-sidebar-accent` + `hover:text-sidebar-accent-foreground`)
  to confirm the row is clickable.
- A **negative horizontal margin** of `-mx-2` so the banner extends
  edge-to-edge inside the sidebar column (offsetting the parent
  `<SidebarGroup>`'s `px-2`). The label keeps its own `px-2` so
  text is not flush against the column edges.
- An override of shadcn's default rounded corners via
  `rounded-none` — rounded corners on an edge-to-edge banner read
  as visual debris.
- An override of the native `<button>` default `text-align: center`
  via `text-left` so the project name sits flush-left inside its
  `flex-1` span instead of floating to the row's middle.

The header's two child elements, in left-to-right DOM order, are:

1. The **project name** in uppercase, **one type-size smaller than
   the surrounding body text** (e.g. `text-[10px]` against the
   `text-xs` body), styled `font-semibold uppercase tracking-wider`.
   The span MUST receive `truncate min-w-0 flex-1` so that **when
   horizontal space runs out the project name (not the pill) is
   the one truncated to ellipsis**. The project name span SHALL
   NOT receive `font-mono`.
2. The **right-aligned `<GitStatusPill project={name}
   variant="compact" />`** with `shrink-0` so it never compresses.
   The pill SHALL NOT carry a `max-w-*` cap, an `overflow-hidden`
   override, or any other class that truncates the branch / status
   text. When the project is not a git repo (or git is unavailable),
   the pill renders nothing and the row width SHALL NOT shift.

The entire header row SHALL be the `<CollapsibleTrigger>`; a click
on any non-pill pixel of the row (banner background, name span,
empty space) toggles expand/collapse. A click ON the
`<GitStatusPill>`, however, SHALL NOT propagate to the trigger;
instead it SHALL open a project-scoped `<GitDiffDialog>` (see the
"Click on the git pill opens the diff dialog" scenario below). The
hover-only inline tooltip rendered by the compact pill remains
unchanged; click and hover are independent affordances.

Implementation: the pill is wrapped in a `<span role="button"
tabIndex={0} aria-label="View git diff for <project>">` whose
`onClick`, `onPointerDown`, and `onKeyDown` (Enter / Space)
handlers call `event.preventDefault()` + `event.stopPropagation()`
and invoke a parent-supplied `onPillClick` callback. The
`<GitDiffDialog>` itself is mounted at `<AppSidebar>` level,
keyed by `diffDialogProject` state, so only one dialog instance
exists for the whole sidebar regardless of which project's pill
was clicked.

#### Scenario: Header renders banner background + top/bottom dividers
- **WHEN** a project section's header renders in the sidebar
- **THEN** the `<SidebarGroupLabel>` element's class list includes
  `border-y`, `border-sidebar-border`, and `bg-sidebar-accent/60`
- **AND** the resolved CSS sets `border-top-width: 1px` and
  `border-bottom-width: 1px`, both with color `var(--sidebar-border)`

#### Scenario: Banner is fixed at h-7 with edge-to-edge negative margin
- **WHEN** a project section's header renders
- **THEN** the `<SidebarGroupLabel>` element's class list includes
  `h-7` (NOT `h-auto`)
- **AND** the class list includes `-mx-2` so the banner extends
  edge-to-edge inside the sidebar column
- **AND** the class list includes `rounded-none` and `text-left`
  (overriding shadcn's default `rounded-md` and the native button
  center alignment respectively)

#### Scenario: No expand/collapse indicator glyph is rendered
- **WHEN** a project section's header renders
- **THEN** the trigger element contains NO `<svg>` descendant with
  class `lucide-chevron-down`, `lucide-chevron-right`, or any other
  `lucide-chevron-*` variant — the banner styling alone signals
  expand/collapse state via its contrast against the body

#### Scenario: DOM order is name then pill
- **WHEN** a project section's header renders
- **THEN** the trigger's direct children are exactly two elements,
  in this order: the uppercase project-name span and either the
  bare `GitStatusPill` (`data-slot="git-status-pill-compact"`) for
  non-git projects OR the `<span data-slot="git-status-pill-trigger">`
  wrapper around the pill for git-enabled projects

#### Scenario: Project name is one type-size smaller than body
- **WHEN** the section header renders against a sidebar body using
  `text-xs` (12px) per the shadcn defaults
- **THEN** the project-name span resolves to a smaller computed font
  size (e.g. `text-[10px]` ⇒ 10px), conveying VSCode-style
  small-caps-banner hierarchy

#### Scenario: Project name renders uppercase, not font-mono
- **WHEN** the section header renders
- **THEN** the project-name span's class list resolves to a CSS rule
  that sets `text-transform: uppercase` AND does NOT set
  `font-family: var(--font-mono)` (or any other monospace family)

#### Scenario: Long branch name truncates the project title, not the pill
- **GIVEN** a project whose git pill resolves to a wide payload
  (e.g. branch `feature/very-long-experimental-branch-name` with
  ahead/behind arrows) and a long project name
- **WHEN** the section header renders inside a narrow sidebar
- **THEN** the `<GitStatusPill>` element renders **without** any
  ellipsis or visual clipping of its text content; the pill consumes
  its natural width
- **AND** the project-name span truncates with a CSS ellipsis (the
  `truncate` rule on `min-w-0 flex-1`) so the row width is preserved

#### Scenario: Pill carries shrink-0 and no width cap
- **WHEN** the section header renders
- **THEN** the `<GitStatusPill>` element's class list resolves to
  rules that include `flex-shrink: 0` (e.g. via Tailwind `shrink-0`)
- **AND** the class list does NOT resolve to any rule that sets
  `max-width: *` or `overflow: hidden` on the pill wrapper itself

#### Scenario: Whole row (except pill) remains the click target
- **WHEN** the user clicks any non-pill pixel inside the header row
  (the name span, the empty space between name and pill, the banner
  margins)
- **THEN** the section toggles its expanded state

#### Scenario: Click on the git pill opens the diff dialog without toggling the section
- **GIVEN** the section is currently expanded and the project's git
  pill is rendered with a git-enabled status (so the
  `<span data-slot="git-status-pill-trigger">` wrapper is rendered)
- **WHEN** the user clicks directly on the pill-trigger wrapper
- **THEN** the click event SHALL NOT propagate to the
  `<CollapsibleTrigger>` button — the section remains expanded
- **AND** a `<GitDiffDialog>` element (`data-slot="git-diff-dialog"`)
  is mounted in the document, keyed to this project
- **AND** the dialog surfaces the project's working-tree diff
  (staged / unstaged / untracked files plus per-file diff content)
  via the existing `git-status-files` / `git-diff` API surfaces
- **AND** the hover-only inline `Tooltip` rendered by the compact
  pill remains a separate affordance — hovering still opens the
  tooltip; clicking opens the dialog. They do not conflict.

#### Scenario: Pill click target is keyboard-reachable
- **GIVEN** the section header renders with a git-enabled pill
- **WHEN** the user tabs onto the pill-trigger wrapper and presses
  `Enter` or `Space`
- **THEN** the same `<GitDiffDialog>` opens as on a pointer click
- **AND** the surrounding `<CollapsibleTrigger>` does NOT receive
  the keystroke (the wrapper's `onKeyDown` handler calls
  `preventDefault` + `stopPropagation`)

#### Scenario: Non-git project renders the bare pill (no click target)
- **GIVEN** project B is not a git repo (the
  `['git-status', 'project-B']` query resolves with
  `enabled: false`)
- **WHEN** the project section's header renders
- **THEN** the header's second child is the bare `GitStatusPill`
  (which itself returns `null` for `enabled: false`); NO
  `data-slot="git-status-pill-trigger"` wrapper is rendered
- **AND** clicking anywhere inside the header (since the pill is
  absent) toggles the section like any other header click

#### Scenario: Pill absence does not shift the row
- **GIVEN** project A is a git repo (pill renders) and project B is
  not (pill returns `null`)
- **WHEN** both sections render
- **THEN** the project-name span in each header sits at the same
  horizontal position; only the right-edge pill differs

### Requirement: Sidebar sections use a CSS Grid row-template for multi-expand height distribution

The sidebar's `<SidebarContent>` SHALL be laid out as a CSS Grid
(NOT a flex column) so simultaneously-expanded sections share
height via the grid's row-template, and so the banner of every
closed section is protected by an explicit per-row minimum.

`<SidebarContent>` SHALL apply `!grid !overflow-hidden` to
override the shadcn primitive's default
`flex min-h-0 flex-1 flex-col gap-0 overflow-auto`. The `!`
modifier (Tailwind's `important`) is required because shadcn's
defaults specify `flex` directly on the element and would
otherwise win the cascade.

The element's inline `gridTemplateRows` SHALL be computed from the
current set of expanded project names — one grid row per visible
project, in render order. Each row SHALL resolve to:

- `minmax(var(--sidebar-section-banner-h, 1.75rem), 0fr)` when the
  project is **closed** — the row is pinned at the banner height
  (28px), with no slack.
- `minmax(var(--sidebar-section-banner-h, 1.75rem), 1fr)` when the
  project is **open** — the row's minimum is still the banner
  height, but its maximum is `1fr`, so it competes with sibling
  open rows for the remaining grid height.

The `--sidebar-section-banner-h` CSS custom property MAY be
overridden from a parent style block; absent override the
fallback `1.75rem` matches the banner's fixed `h-7` class.

When N sections are open simultaneously, each open row receives
`(content-height − closed-rows-banner-total) / N` of the
available height. Closed rows stay pinned at banner height
exactly; open rows split the remainder evenly via the `fr`
shares. Banners NEVER compress regardless of open count or
content height — the per-row `minmax` minimum is a hard floor.

Each `<Collapsible>` wrapper SHALL be one grid row; the wrapper
itself SHALL carry only `flex min-h-0 flex-col overflow-hidden`
(NO `flex-grow` / `flex-1` / `flex-none` toggle — those are now
the outer grid's job). The inner `<SidebarGroup>` SHALL carry
`flex min-h-0 flex-1 flex-col` unconditionally so its
`<CollapsibleContent>` (with `flex-1 min-h-0 overflow-hidden`)
can resolve against a known parent height and the inner scroll
`<div className="h-full overflow-y-auto">` actually scrolls.

`<CollapsibleContent>` SHALL be `forceMount`-ed so Radix keeps
the element in the DOM at all times (just `display: none`-ing it
when closed). This avoids re-mount cost on open/close and lets
the outer grid's row transition drive the height animation
without competing with Radix's own
`animate-collapsible-down/up` keyframes (those are NOT applied —
their `height: 0 → var(--radix-collapsible-content-height)`
animation would fight the grid-row sizing and snap-jump).

#### Scenario: SidebarContent overrides shadcn flex with grid
- **WHEN** the sidebar renders
- **THEN** the `<SidebarContent>` element's class list includes
  `!grid` and `!overflow-hidden`
- **AND** the element's inline `style` carries `grid-template-rows`
  with one entry per visible project

#### Scenario: Closed sections pin at banner height
- **GIVEN** the sidebar shows three projects, all closed
- **WHEN** the sidebar renders
- **THEN** the inline `grid-template-rows` is
  `minmax(var(--sidebar-section-banner-h, 1.75rem), 0fr) ×3`
  (each row's max is `0fr`, so each row consumes exactly the
  minimum 1.75rem = 28px)

#### Scenario: Two open sections split the remaining height evenly
- **GIVEN** the sidebar shows three projects: A (open), B
  (closed), C (open), and the content area is tall enough that
  the open rows have meaningful slack
- **WHEN** the sidebar renders
- **THEN** the inline `grid-template-rows` reads
  `minmax(..., 1fr) minmax(..., 0fr) minmax(..., 1fr)`
- **AND** A's and C's rendered heights are approximately equal
  (within a few pixels), each consuming roughly
  `(content-height − banner-h) / 2`
- **AND** B's row stays pinned at banner height (28px)

#### Scenario: Banner safety under overflow
- **GIVEN** a section's experiment list contains more content
  than fits in the open row's allocated height
- **WHEN** the sidebar renders
- **THEN** NO sibling section's banner is visually compressed
  below 28px (the per-row `minmax` minimum is a hard floor);
  excess content scrolls inside the open section's body via the
  `h-full overflow-y-auto` div, not by stealing space from
  siblings

#### Scenario: forceMount keeps CollapsibleContent in the DOM
- **WHEN** any project section renders, whether open or closed
- **THEN** its `<CollapsibleContent>` element is present in the
  DOM (Radix `forceMount` is applied)
- **AND** when the section is closed, Radix sets the element's
  `hidden` attribute (or `display: none`) so the row's intrinsic
  height is the banner alone

### Requirement: Section expand/collapse height animation

The sidebar SHALL animate every visible section's height
simultaneously when the expanded set changes. The animation SHALL
be driven by a CSS transition on `<SidebarContent>`'s
`grid-template-rows` property, NOT by per-row Radix keyframes.

The transition SHALL be `200ms ease-out` and SHALL apply to
`grid-template-rows` only (e.g.
`transition-[grid-template-rows] duration-200 ease-out`).
Browsers Chrome 121+ and Firefox 117+ natively interpolate the
`fr` component of `minmax(<length>, <Nfr>)` when only the `fr`
component differs between same-typed `minmax()` values on the
same row position. Older browsers will jump rather than
interpolate, but the layout remains correct on every keyframe;
the change is purely visual polish.

When the user opens a previously-closed section, every other
visible row's height reflows smoothly: open siblings shrink
slightly to make room (their `1fr` share decreases as N grows);
closed siblings remain pinned. When the user closes an open
section, the remaining open siblings grow smoothly to fill the
freed space.

The banner of every section SHALL remain visible throughout the
transition — the per-row `minmax` minimum is the same in both the
start and end states, so the `fr` interpolation never crosses
below the banner-height floor.

#### Scenario: SidebarContent declares a grid-template-rows transition
- **WHEN** the sidebar renders
- **THEN** the `<SidebarContent>` element's class list includes
  `transition-[grid-template-rows]` and `duration-200` and
  `ease-out` (or equivalent classes whose computed
  `transition-property` is `grid-template-rows` and whose
  duration is 200 ms)

#### Scenario: Opening one section smoothly rebalances siblings
- **GIVEN** two open sections A and C and one closed section B
  in the middle
- **WHEN** the user clicks B's banner to open it
- **THEN** the grid-template-rows inline style flips from
  `1fr 0fr 1fr` to `1fr 1fr 1fr` on the same SidebarContent
  element
- **AND** the rendered heights of A, B, C transition over
  ≈200ms to settle at roughly one-third of the content height
  each; no row pops to its final size in a single frame

#### Scenario: Closing a section frees its space to siblings
- **GIVEN** three open sections A, B, C each at roughly one-third
  of the content height
- **WHEN** the user clicks B's banner to close it
- **THEN** the grid-template-rows flips from `1fr 1fr 1fr` to
  `1fr 0fr 1fr`
- **AND** B shrinks to banner height while A and C each grow to
  roughly half the content height (minus banner totals) over
  the same 200ms transition

### Requirement: Sidebar experiment rows include a per-row "new terminal" launcher

Each experiment row inside an expanded project section SHALL render
a trailing icon-only "new terminal" launcher to the right of the
exp-id span. The button SHALL be the last visual element in the row
and SHALL behave as follows:

- The icon SHALL be `lucide-react`'s **`Plus`** at `size-3.5`,
  wrapped in a `<Button variant="ghost" size="icon" className="size-6 shrink-0">`
  (or equivalent small ghost button). The Plus framing reads as
  "create a new terminal" rather than "this row is itself a
  terminal" — a `Terminal` icon was deliberately rejected.
- The button's `aria-label` SHALL follow the pattern
  `"New terminal for <exp-id>"` (or, in the disabled state,
  `"New terminal for <exp-id> (ttyd unavailable)"`).
- The button SHALL be **always visible** (NOT hover-revealed) so it
  is discoverable and keyboard-reachable.
- Clicking the button SHALL open a **right-side `<TerminalSheet>`
  drawer** (the existing `<Sheet side="right">`-backed component)
  scoped to that experiment, parameterized with
  `{ project: <project>, scope: 'exp', slug: <exp-id>,
  agent: 'none' }` — i.e. a **plain shell** session, not a
  `claude code` session.
- Clicking the button SHALL NOT navigate the surrounding link to
  `/p/<project>/e/<exp-id>`. The button SHALL stop event
  propagation OR sit outside the `<Link>` element so the link does
  not also fire.

Viewer-session gating:

- When `useSession().role === 'viewer'`, the button SHALL render
  nothing.

ttyd-availability gating:

- The component SHALL read the existing TanStack query
  `['terminal','check']` (the same probe used by `TerminalButton`).
- When the probe has not yet resolved, the button MAY render a
  disabled placeholder OR render nothing (consistent with how
  `TerminalButton` handles its first-paint phase).
- When the probe reports ttyd is unavailable AND not
  auto-downloadable, the button SHALL render disabled with a
  tooltip surfacing the probe's `suggestion` field (or
  `"ttyd unavailable"`).
- When the probe reports ttyd is auto-downloadable, the button MAY
  render disabled with a tooltip pointing the user to the existing
  install affordance, OR render as enabled and trigger the install
  flow inline. Either behavior is acceptable; the rendering MUST
  NOT silently fail.

#### Scenario: Owner sees the "+" button on every experiment row
- **GIVEN** an owner session and a project with three experiments
- **WHEN** the project section is expanded
- **THEN** each of the three rows contains a Plus icon button
  after the exp-id span with `aria-label="New terminal for
  <exp-id>"`

#### Scenario: Viewer does not see the "+" button
- **GIVEN** a viewer session
- **WHEN** the project section is expanded
- **THEN** none of the experiment rows contain a Plus icon button;
  the rest of the row (leading run-count badge, exp-id span)
  renders unchanged

#### Scenario: Click opens right-side TerminalSheet drawer with agent: 'none'
- **GIVEN** an owner session and ttyd is available
- **WHEN** the user clicks the Plus icon on the row for experiment
  `E0007-foo` in project `project-a`
- **THEN** a `<TerminalSheet>` opens as a right-side drawer (the
  underlying `<Sheet side="right">` slides in from the right edge of
  the viewport)
- **AND** under the hood the sheet's call to `startTerminal` resolves
  with the payload `{ project: 'project-a', scope: 'exp',
  slug: 'E0007-foo', agent: 'none' }`
- **AND** the page URL has NOT navigated to
  `/p/project-a/e/E0007-foo`

#### Scenario: ttyd missing renders disabled button
- **GIVEN** an owner session and the `['terminal','check']` probe
  reports `available: false, downloadable: false`
- **WHEN** the project section is expanded
- **THEN** each experiment row's Plus icon is rendered in a disabled
  state with a tooltip surfacing the probe's `suggestion` (or the
  fallback `"ttyd unavailable"`)

#### Scenario: Click on button does not navigate the row link
- **GIVEN** an owner session and ttyd is available
- **WHEN** the user clicks the Plus icon on a row whose link target
  is `/p/project-a/e/E0007-foo`
- **THEN** the page URL after the click is unchanged (the click did
  NOT navigate the surrounding `<Link>`); only the right-side
  `<TerminalSheet>` drawer opened

### Requirement: Experiment row leading run-count badge replaces the indent gutter

Each experiment row inside an expanded project section SHALL render
a leading circular run-count badge as the row's **first visual
element**. The badge plays two roles at once: it is the row's
left-side indentation cue (replacing the previous transparent
`<span aria-hidden className="w-6 shrink-0" />` spacer) AND a
passive numeric badge showing `exp.frontMatter.runs.length`.

The badge SHALL be a `<span>` with `aria-label="{N} runs"`
(where `N` is the run count) whose class list resolves to:

- a `flex` layout that horizontally and vertically centers its
  text content,
- a fixed square size of `size-[1.125rem]` (≈18px),
- `shrink-0` so the badge never compresses,
- `rounded-full` for a circular shape,
- a subtle fill `bg-sidebar-foreground/5` that remains legible
  against both the resting body background and the
  `bg-sidebar-accent` active-row highlight,
- `text-[9px] tabular-nums text-sidebar-foreground/60` for the
  count itself.

The badge SHALL be rendered as a direct child of the row's
`<Link>` element (NOT as a sibling outside the link's
active-highlight wrapper). This means clicking the badge follows
the same navigation as clicking anywhere else in the link.

The badge SHALL be rendered for every experiment row, including
experiments with zero runs (`runs.length === 0`); the visible
text is just `0`. The badge is the row's leading visual anchor
and the row width SHALL NOT shift between zero-run and many-run
experiments.

#### Scenario: Each row's first visual element is a circular run-count badge
- **GIVEN** a project section is expanded with two experiments,
  `E0001-foo` (3 runs) and `E0002-bar` (0 runs)
- **WHEN** the sidebar renders
- **THEN** each row's `<Link>` contains a leading `<span>` with
  `aria-label="3 runs"` / `aria-label="0 runs"` respectively
- **AND** the span's class list includes `size-[1.125rem]`,
  `rounded-full`, `bg-sidebar-foreground/5`, and `text-[9px]`
- **AND** the span sits at the row's leading edge, immediately
  followed by the exp-id span

#### Scenario: Badge replaces the previous indent gutter spacer
- **GIVEN** any sidebar render after this change ships
- **WHEN** any experiment row is inspected
- **THEN** the row does NOT contain a separate transparent
  `<span aria-hidden className="w-6 shrink-0" />` indent spacer
  (this element was previously rendered before the link as the
  row's first child); the leading badge is the only leading
  visual

#### Scenario: Badge sits inside the active-row highlight
- **GIVEN** a row whose `isActive === true`
- **WHEN** the sidebar renders
- **THEN** the badge is rendered inside the active-highlight
  wrapper, so the highlight background sits underneath the badge
  rather than around it

### Requirement: Sidebar footer has a visual divider above the footer widgets

The `<SidebarFooter>` element SHALL render a 1px top border (via
`border-t border-sidebar-border` or equivalent) so the
`SlurmStatusWidget` + `Manage tmux` row block is visually separated
from the project section list above. The token `--sidebar-border`
MUST already be defined in `apps/web/app/globals.css`; the divider
SHALL NOT introduce new CSS variables.

#### Scenario: Footer carries a top border
- **WHEN** the sidebar renders on a project page (owner session)
- **THEN** the `<SidebarFooter>` element's computed style has a
  non-zero top border whose color matches
  `var(--sidebar-border)`

#### Scenario: Token is already defined
- **WHEN** introducing the `border-sidebar-border` class
- **THEN** `apps/web/app/globals.css` already contains a definition
  for `--sidebar-border` (no new CSS variable is added by this
  change)

#### Scenario: Footer divider visible on /manage/* routes too
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the footer block (which still contains `Manage tmux`)
  carries the same top border above its content as on project pages

### Requirement: Loading spinner shows when section first opens with no cached data

The sidebar SHALL render a loading spinner inside any expanded
project section whose experiments query has not yet resolved with
cached data, so the user knows the section is fetching rather
than mistaking the empty body for "no experiments". Specifically:
when a project section is expanded AND TanStack Query reports
the `['experiments', project]` query is in the `isLoading` state
AND there is no cached array of experiments yet, the section
body SHALL render a centered loading spinner.

The spinner SHALL be a `<Loader2 />` icon from `lucide-react`
at `size-4`, rendered inside a wrapper marked
`data-slot="exp-list-loading"` with classes that center it
horizontally and vertically (e.g.
`flex items-center justify-center py-3 text-sidebar-foreground/50`).
The icon SHALL carry the `animate-spin` Tailwind class and an
accessible label (`aria-label="Loading experiments"`).

The spinner SHALL be shown only when ALL of the following hold:

1. The section is currently expanded (`enabled === true`).
2. The query is in `isLoading` state (no resolved data yet).
3. The cached `docs.length` is `0` (no previously-fetched array).

When previous data is cached (e.g. the user toggles the section
closed and re-opens it), TanStack Query returns the cached
array while it refetches in the background. The `docs.length
> 0` check SHALL skip the spinner branch and render the cached
rows immediately — no spinner, no skeleton, no "View more"
affordance.

When the section is closed (`enabled === false`), nothing
renders (return `null` before the spinner check) so the
collapsed section's row stays at banner height.

#### Scenario: First open with no cache shows the spinner
- **GIVEN** a project section that has never been opened in
  this page lifecycle (no cached `['experiments', project]`
  data)
- **WHEN** the user clicks the project banner to expand it
- **THEN** the section body immediately renders a
  `<div data-slot="exp-list-loading">` containing a spinning
  `<Loader2>` icon
- **AND** when the API responds, the spinner is replaced by
  the experiment list

#### Scenario: Re-open with cached data skips the spinner
- **GIVEN** a project section that was previously opened, has
  cached experiments, and was then closed
- **WHEN** the user re-opens the section
- **THEN** the cached experiment rows render immediately; no
  `data-slot="exp-list-loading"` element is mounted
- **AND** TanStack Query may issue a background refetch but the
  user sees the cached rows the whole time

#### Scenario: Closed section renders nothing
- **GIVEN** a project section that is collapsed (`enabled === false`)
- **WHEN** the sidebar renders
- **THEN** the `ProjectExperimentDocs` body renders nothing
  (the function returns `null`) — no spinner, no list, no
  empty-state placeholder

### Requirement: Active experiment row highlight covers the wrapper from the leading badge to the trailing button

The sidebar SHALL highlight the row of the currently-open
experiment (the row whose id matches the `:expDocId` URL segment
under `/p/<project>/e/`) to confirm navigation context. The
highlight SHALL satisfy a single coverage constraint: it covers
the entire wrapper that contains the leading run-count badge, the
exp-id span, and the trailing per-row "+" terminal button — i.e.
all interactive content of the row sits on the highlighted
background.

Concretely:

- The highlight background SHALL cover the wrapper `<div>` that
  is the row's single source of background truth. The wrapper
  contains, in order: the `<SidebarMenuButton asChild>`-rendered
  `<Link>` (which itself contains the leading run-count badge and
  the exp-id span), and the trailing `<ExpRowTerminalButton>`
  (the Plus icon button). The Plus button SHALL appear inside
  the highlighted region, not as a stray un-highlighted control
  floating to the right.
- The inner `<SidebarMenuButton>`'s default
  `hover:bg-sidebar-accent` and `data-[active=true]:bg-sidebar-accent`
  paints SHALL be suppressed (via `hover:bg-transparent` and
  `data-[active=true]:bg-transparent` overrides) so the wrapper
  remains the single source of background truth — no double-paint,
  no edge mismatch between the link and the button.
- An inactive row's wrapper SHALL apply
  `hover:bg-sidebar-accent/40` (a lighter on-hover tint) so the
  row still reads as clickable on hover; active and inactive
  rows share the same wrapper layout and differ only by
  background opacity.

Implementation: the `<SidebarMenuItem>` wraps a single
flex-row `<div className="flex min-w-0 flex-1 items-center
rounded-md transition-colors ...">` that holds both the
`<SidebarMenuButton>` and the `<ExpRowTerminalButton>`. The
wrapper's class list reads
`isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' :
'hover:bg-sidebar-accent/40'`. There is NO separate transparent
indent gutter spacer; the leading run-count badge (rendered
inside the link) is the row's leading visual.

#### Scenario: Active row's highlight covers badge + id + Plus button continuously
- **GIVEN** a project section is expanded and the user is currently
  viewing experiment `E0007-foo`
- **WHEN** the sidebar renders
- **THEN** the highlight background extends continuously from the
  left edge of the leading run-count badge all the way to the
  right edge of the trailing Plus button (no un-highlighted gap
  appears anywhere along the row)
- **AND** the Plus button itself sits visually inside the
  highlighted region

#### Scenario: Inactive row reverts to a hover-only tint
- **GIVEN** a project section is expanded with two experiments
  `E0001-alpha` and `E0002-beta`, and the user is viewing
  `E0001-alpha`
- **WHEN** the sidebar renders
- **THEN** only `E0001-alpha`'s row carries the
  `bg-sidebar-accent` wrapper background; `E0002-beta`'s row
  has no resting background and only paints
  `bg-sidebar-accent/40` on hover

#### Scenario: Inner SidebarMenuButton bg is suppressed
- **WHEN** any experiment row renders
- **THEN** the inner `<SidebarMenuButton>` element's class list
  includes `hover:bg-transparent` AND
  `data-[active=true]:bg-transparent` so the wrapper's background
  is the only one visible regardless of the button's own active
  / hover state

## MODIFIED Requirements

### Requirement: Per-project collapsed-by-default with on-demand run list

Each project group in the sidebar SHALL be collapsed by default.
Clicking the project's header SHALL toggle expansion. When expanded,
the group SHALL display **all of the project's active (non-archived)
experiments**, each as a clickable row that navigates to
`/p/<project>/e/<exp-id>`. The list SHALL render inside an internally
scrollable container so long lists do not overflow the section
(the per-row scroll lives in the section's
`<div className="h-full overflow-y-auto">` inside
`<CollapsibleContent>`, fed by the outer grid-row sizing — see the
"CSS Grid row-template" requirement).

The expanded group SHALL render **exactly one** sub-section under the
project header — the experiments list. The sidebar SHALL NOT render a
separate `Runs` sub-section under any project group, and SHALL NOT
show a separate "All Runs" entry anywhere in the sidebar. Runs are
reachable only through their parent experiment page (or the orphan
cards on the project list page).

The experiment list SHALL be sorted by `effectiveUpdatedAt`
descending so the most recently active experiment appears at the top.
This matches the default order on the `Experiments` list page
(`experiment-card-grid.tsx`); the two surfaces SHALL stay in sync on
sort key and direction.

The expanded group MAY omit a sub-section heading label (e.g. an
uppercase "Experiments" caption above the list) since there is only
one sub-section per project group; the project group header itself
provides sufficient context.

The per-project counter badge in the sidebar SHALL show the number of
**experiments** in that project (not the number of runs).

Each rendered experiment row SHALL render a leading circular
run-count badge as the row's first visual element — see the
"Experiment row leading run-count badge replaces the indent
gutter" requirement for full styling and accessibility. The badge
plays the role the previous transparent indent gutter played
(setting the row's leading column), while also exposing the
`runs.length` count.

#### Scenario: Initial load
- **WHEN** the user opens the dashboard for the first time (no prior
  expanded state)
- **THEN** every project group is collapsed; no experiment rows are
  rendered in the sidebar

#### Scenario: Click to expand shows experiments not runs
- **WHEN** the user clicks a project header
- **THEN** the project expands and shows experiment rows; each
  row's link target is `/p/<project>/e/<exp-id>` (NOT a run dir)

#### Scenario: All active experiments are listed, not just the first 5
- **GIVEN** a project with 12 active (non-archived) experiments
- **WHEN** the user expands the project's group
- **THEN** all 12 experiment rows are rendered inside the section
  body
- **AND** the rendered list scrolls internally (`overflow-y-auto`)
  rather than expanding the sidebar to fit all 12 rows
- **AND** no "View more" or "Show fewer" affordance is rendered

#### Scenario: Counter badge reflects experiment count
- **GIVEN** a project with 12 experiments containing 47 runs total
- **WHEN** the sidebar renders
- **THEN** the project's counter badge shows `12` (not `47`)

#### Scenario: No Runs sub-section is rendered when expanded
- **WHEN** the user expands a project that has both v3 exp docs and
  legacy run dirs
- **THEN** the sidebar group renders the experiments list and nothing
  else under that project header — no `Runs` caption, no run rows, no
  link to a per-run URL

#### Scenario: Experiments rendered in `effectiveUpdatedAt`-descending order
- **GIVEN** a project with three exp docs A, B, C whose
  `effectiveUpdatedAt` are
  `2026-05-04T10:00:00+08:00` (A), `2026-05-06T08:00:00+08:00` (B),
  `2026-05-05T15:00:00+08:00` (C)
- **WHEN** the user expands the project's group
- **THEN** the rendered row order is B, C, A (top to bottom) — newest
  first, matching the default sort on the experiments list page

#### Scenario: Leading visual is the run-count badge, not a transparent spacer
- **WHEN** a section is expanded
- **THEN** each experiment row's leading element is the circular
  run-count badge (per the "Experiment row leading run-count
  badge" requirement); there is NO transparent
  `<span aria-hidden className="w-6 shrink-0" />` spacer in front
  of the badge

## REMOVED Requirements

### Requirement: "View more" temporary expansion past 5 runs

**Reason**: The new VSCode-Explorer-style section layout (see the
ADDED requirement "Sidebar sections use a CSS Grid row-template
for multi-expand height distribution") makes every section's body
internally scrollable. With internal scroll there is no longer any
reason to cap rendered rows at 5 — the user can simply scroll within
the section to reach older experiments. Removing the cap + "View
more" affordance removes a click for the common case and removes
component-local pagination state.

**Migration**: No user-facing data migration needed. The
`DEFAULT_VISIBLE = 5` constant and the local `showAll: boolean`
state in `ProjectExperimentDocs` (and any related "View more (N) /
Show fewer" markup) SHALL be removed from
`apps/web/components/app-sidebar.tsx`. Existing
`memon:sidebar:expanded` localStorage values continue to work
unchanged (the persisted shape never carried per-section
"View more" state). No spec downstream of `web-layout` depended on
this requirement, so no follow-on spec edits are required.
