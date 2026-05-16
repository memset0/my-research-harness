## Context

The current `AppSidebar` (`apps/web/components/app-sidebar.tsx`) is built
on shadcn primitives — `Sidebar`, `SidebarContent`, `SidebarFooter`,
`SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu`, plus `Collapsible`
+ `CollapsibleTrigger` + `CollapsibleContent` — and renders each project
as a `<Collapsible>`-wrapped `<SidebarGroup>`. Header row order today:

```
[project-name]  [GitStatusPill compact]  [ChevronDown rotates 180°]
```

The expanded body (`ProjectExperimentDocs`) caps the rendered list at
`DEFAULT_VISIBLE = 5` and exposes a local "View more (N) / Show fewer"
toggle backed by component-scoped `showAll` state.

Two patterns in adjacent components are directly relevant for the new
per-row terminal button:

- **`TerminalButton`** (`apps/web/components/terminal-button.tsx`) —
  uses `useQuery({ queryKey: ['terminal','check'] })` to probe ttyd,
  gates rendering on `role === 'owner'` (via `useSession`), and opens
  a `<TerminalSheet>` with `agent: 'claude'`. We reuse the probe key
  and the sheet but pass `agent: 'none'` for the section-row launcher.
- **`TerminalSheet`** (`apps/web/components/terminal-sheet.tsx`) —
  internally calls `startTerminal({ project, scope, slug, agent })`
  on open and `stopTerminal(sessionName)` on close. It accepts
  `{ runId, projectName }` props for back-compat and maps them to
  `{ project: projectName, scope: 'run', slug: runId, agent: 'claude' }`.
  We add a small variant path (or props) so the sidebar can pass
  `agent: 'none'` without forking the sheet.

`memon:sidebar:expanded` localStorage and the
`expanded: Set<string>` state machine that owns it stay as-is — the
shape of which sections are open does not change, only their visual
presentation.

## Goals / Non-Goals

**Goals:**

- Make each project look and behave like a VSCode Explorer section:
  chevron-led header, uppercase project name, internally scrolling
  body, even vertical-space distribution across simultaneously
  expanded sections.
- Surface git status on the right of the section header where it
  reads as section metadata, not as part of the project name.
- Give the owner a one-click per-experiment shell from the sidebar
  without contending with the existing `claude code` launcher.
- Keep persistence, query keys, SSE invalidation, and the underlying
  shadcn primitives untouched.

**Non-Goals:**

- No drag-and-drop reordering of sections (VSCode allows it; we don't).
- No per-section settings menu (kebab / "..."). Out of scope.
- No change to the route URL shape, the experiment row's link target,
  or the run-count number on the right of each row.
- No new ttyd / tmux capability — the plain-shell flow rides on the
  existing browser-terminal capability with the existing
  `agent: 'none'` enum value.
- No mobile-specific redesign. The shadcn `Sidebar` already slides in
  as a drawer on narrow viewports; this change inherits that behavior
  unchanged.

## Decisions

### D1. Section header: banner styling (no chevron); name yields width to pill

**Iterated post-apply** — the first-cut design used a chevron-left
indicator as the expand/collapse cue. After visual review the user
explicitly preferred a VSCode-Explorer-style **banner header** where
the contrast between header and body IS the affordance: tinted
background + 1px top/bottom dividers, no glyph. The chevron was
removed. A second iteration tuned the banner to its final form
(deeper bg, fixed height, edge-to-edge, rounded-none, left-aligned).

The current `SidebarGroupLabel` body is:

```tsx
<SidebarGroupLabel
  asChild
  className={cn(
    // h-7 (fixed 28px) matches the outer grid-row template's
    // minmax(1.75rem, …) minimum exactly.
    'h-7 cursor-pointer rounded-none border-y border-sidebar-border',
    // bg-sidebar-accent/60 (deeper than the first cut's /40)
    'bg-sidebar-accent/60 px-2 -mx-2 text-left',
    'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
    isActive && 'text-sidebar-primary',
  )}
>
  <CollapsibleTrigger>
    <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider">
      {name}
    </span>
    {gitEnabled ? (
      <span role="button" tabIndex={0} onClick={…} onPointerDown={…} onKeyDown={…} aria-label={`View git diff for ${name}`}>
        <GitStatusPill project={name} variant="compact" className="shrink-0" />
      </span>
    ) : (
      <GitStatusPill project={name} variant="compact" className="shrink-0" />
    )}
  </CollapsibleTrigger>
</SidebarGroupLabel>
```

- **No chevron / arrow / glyph** in the trigger. The
  `border-y border-sidebar-border` + `bg-sidebar-accent/60` banner
  styling on `SidebarGroupLabel` carries the "section header"
  signal; the hover variant (`hover:bg-sidebar-accent`) confirms
  clickability. Removing the chevron eliminates a column of visual
  noise that the banner already covered.
- **Fixed banner height `h-7` (1.75rem = 28px)**. The fixed height
  matches the outer grid-row template's `minmax(1.75rem, …)` min
  exactly, so closed rows pin at banner height with no slack and
  banners never compress when siblings expand. The earlier
  `h-auto` cut allowed intrinsic-content variation between
  projects with and without a git pill, which subtly drifted the
  banner heights and broke the visual rhythm.
- **`bg-sidebar-accent/60`** (deeper than the first-cut `/40`).
  Owner-requested after visual review: the `/40` was too pale
  against the redesigned resting layout; `/60` reads as a clear
  "this is a section delimiter" without dominating the row.
- **`-mx-2` edge-to-edge banner**. The parent `<SidebarGroup>`
  carries `px-2` for body content. The negative horizontal margin
  offsets that, so the banner extends to the sidebar column's
  left and right edges (matching VSCode's banner style); the
  banner's own `px-2` keeps text from being flush against the
  edges.
- **`rounded-none`** overrides shadcn's default `rounded-md` —
  rounded corners on an edge-to-edge banner read as visual debris.
- **`text-left`** overrides the native button default
  `text-align: center`. Without this, `CollapsibleTrigger`
  renders the project name floating to the row's middle inside
  its `flex-1` span instead of sitting flush-left.
- **One type size smaller**: `text-[10px]` (vs. the body's `text-xs`
  ≈ 12px). VSCode-style small caps; combined with `font-semibold
  uppercase tracking-wider` it reads as a section banner rather
  than as a row of body text.
- **Name yields width first**: `min-w-0 flex-1 truncate` on the name
  span lets it shrink and ellipsis-truncate when horizontal space
  runs out. The previous `max-w-[8rem] overflow-hidden` cap on the
  git pill is REMOVED: long branch names (e.g.
  `feature/very-long-experimental-branch`) now display in full and
  push the project title to ellipsis instead. The pill gets
  `shrink-0` so it never compresses.
- The entire row remains a single `CollapsibleTrigger`; clicking
  anywhere on the row (banner background, name, the empty space
  between name and pill) toggles expansion. A click ON the
  git-enabled pill is intercepted by a wrapper span and routed
  to a project-scoped `<GitDiffDialog>` instead — see D11.

### D2. Multi-expand even-height distribution via CSS Grid row-template on `SidebarContent`

**Iterated post-apply** — the first-cut design used a flex column
on `<SidebarContent>` with each project as a flex child whose
class flipped between `flex-1 min-h-0` (open) and `flex-none`
(closed). The user surfaced two showstoppers:

1. **Banner compression under overflow**: flex children default
   to `flex-shrink: 1`, so when the open section's content
   overflowed the allocated slot the flex algorithm shrank
   *every* sibling row — including closed sections' banners,
   which compressed below 28px and visually overlapped.
2. **Snap rather than animate**: flex-grow transitions are
   not natively smooth when basis values come from `flex-1`
   distribution. Toggling a section produced an instantaneous
   jump rather than the smooth reflow the user expected.

The new architecture replaces the flex column with a single CSS
**grid** on `<SidebarContent>` whose `grid-template-rows` is
computed from the current expanded set. Each project is one row;
the row's sizing is `minmax(<BANNER_H>, Nfr)` where
`<BANNER_H>` = `var(--sidebar-section-banner-h, 1.75rem)` and
`N = 0` (closed) or `N = 1` (open).

```tsx
<SidebarContent
  style={{
    gridTemplateRows: projects
      .map((p) =>
        expanded.has(p.name)
          ? 'minmax(var(--sidebar-section-banner-h, 1.75rem), 1fr)'
          : 'minmax(var(--sidebar-section-banner-h, 1.75rem), 0fr)',
      )
      .join(' '),
  }}
  className="!grid !overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
>
```

- **Banner safety**: the per-row `minmax` minimum is a hard floor.
  No amount of content overflow can compress a closed section's
  banner below 28px because the grid row size cannot go below the
  min component of `minmax`. The `!overflow-hidden` clip on the
  outer grid ensures content that would otherwise overflow during
  an in-flight transition just clips, instead of bleeding into
  siblings.
- **Smooth multi-section animation**: Chrome 121+ and Firefox
  117+ natively interpolate the `fr` component of
  `minmax(<length>, <Nfr>)` when only `fr` differs between the
  start and end template values on the same row position.
  Animating `gridTemplateRows: 1fr 0fr 1fr` →
  `1fr 1fr 1fr` produces a smooth reflow over the 200ms
  transition. Older browsers will jump but the layout remains
  correct at every keyframe.
- **`!grid` overrides shadcn's flex default**. Tailwind's `!`
  important modifier is required because shadcn ships
  `flex min-h-0 flex-1 flex-col gap-0 overflow-auto` directly on
  the element. We keep `flex-1` for the "fill space between
  header/footer" contract (an earlier cut applied `h-full` here
  and pushed sections past the footer slot — that bug is still
  guarded against by leaving `flex-1` in).
- **Inner Collapsible** carries only `flex min-h-0 flex-col
  overflow-hidden` — no `flex-grow` toggle. The outer grid's row
  template controls height; the wrapper just stacks banner +
  content and clips overflow during transition.
- **Inner `<SidebarGroup>`** always carries
  `flex min-h-0 flex-1 flex-col` so `<CollapsibleContent>`'s
  `flex-1 min-h-0` resolves against a known parent height and
  the inner `<div className="h-full overflow-y-auto">` scrolls.

Alternatives considered:

- **Keep flex but add explicit `min-height` on each row to protect
  the banner** — would need re-measuring on every layout change
  and contended with the flex-grow transition. Rejected as
  fragile.
- **Per-section `max-height` calculated in JS** — same problem,
  same rejection.
- **A single-row `grid-template-rows: 0fr ↔ 1fr` per section
  (each section its own grid)** — this is the canonical
  "animate a section's height" trick, but it only animates the
  toggled section, not the multi-section rebalance. The
  multi-section case is exactly what we needed; we therefore
  use a single grid spanning every section instead.

Trade-off: this design pins the banner height to a fixed value
(`h-7`) because the grid-row minimum is a CSS length, not an
intrinsic measurement. D9 captures the contract that any
banner-style change must update both the class and the CSS
variable in lockstep.

### D3. Remove the 5-item cap and "View more" affordance

`DEFAULT_VISIBLE = 5`, the `showAll: boolean` local state, the
`visible = showAll ? sorted : sorted.slice(0, 5)` slicing, and the
`hasMore` "View more (N) / Show fewer" `<SidebarMenuItem>` all go
away. `ProjectExperimentDocs` simply renders `sorted.map(...)` in
full. The internal-scroll container from D2 makes long lists
ergonomic without an explicit pagination toggle.

This is a strict simplification — the user explicitly asked for it,
and the underlying TanStack query already fetches all experiments
for the project anyway (the 5-item slice was a render-side cap, not
a fetch-side limit).

### D4. Per-row "new terminal" launcher (Plus icon, plain shell, owner-only, ttyd-gated)

Each experiment row's right side becomes:

```
[exp-id (font-mono)]  ...  [runs.length badge]  [Plus icon button]
```

**Iterated post-apply** — the first cut used a lucide `Terminal`
icon. The user pointed out that a Terminal icon makes the row read
as "this row IS a terminal" rather than "click me to create a new
terminal", and asked for a `Plus` icon ("+") instead. We adopted
that: `Plus` reads unambiguously as a create-action, in line with
VSCode / GitHub conventions where a "+" in a list row means
"new item of this kind".

The icon button is a new small subcomponent — call it
`ExpRowTerminalButton({ project, expId })` — colocated in
`app-sidebar.tsx` to keep the change scoped. It MUST:

1. Read `role` via `useSession()` and render `null` when
   `role === 'viewer'`. This matches the existing pattern that
   already hides `SlurmStatusWidget` and "Manage tmux" for viewers.
2. Read `useQuery({ queryKey: ['terminal','check'] })` to probe
   ttyd availability. The query is already mounted on any page that
   shows the existing `TerminalButton`, so the cache hit makes this
   a no-op network-wise in the common case. If `!probe || !probe.available`,
   the icon button is rendered in a disabled state with a tooltip
   ("ttyd unavailable" or the probe's `suggestion` field, mirroring
   `TerminalButton`'s State C).
3. On click, open a right-side `<TerminalSheet>` drawer scoped to
   this row. The sheet needs the four-arg shape `{ project, scope:
   'exp', slug, agent: 'none' }`. We update `TerminalSheet` to
   accept either the legacy `{ runId, projectName }` props (kept
   for back-compat) OR a new `{ project, scope, slug, agent }`
   quartet. The legacy path defaults to `agent: 'claude'` and
   `scope: 'run'` (matching today's behavior). The sheet itself
   uses the existing `<Sheet side="right">` primitive, so the new
   terminal slides in from the right edge of the viewport.
4. Use lucide **`Plus`** icon (`size-3.5`), a `<Button variant="ghost"
   size="icon" className="size-6">` shell, and stop event propagation
   on the click so the surrounding `<Link>` doesn't also navigate.
   The button's `aria-label` follows the pattern
   `"New terminal for <exp-id>"` (or, when disabled,
   `"New terminal for <exp-id> (ttyd unavailable)"`).

Visibility: always rendered (not hover-gated). Rationale: hover-only
controls hide from keyboard users; the existing sidebar rows are
already dense enough that an always-on 14×14 icon adds negligible
visual weight, and it surfaces the feature for discovery.

Server side: `POST /api/terminal/start` already accepts the
`agent: 'none'` enum value (see `TerminalAgentKind` in
`apps/web/lib/api.ts`); no route change needed. The sheet's existing
`stopTerminal` on close also works for the plain-shell session — the
session name format is parameterized on agent + scope + slug
already.

### D5. Footer divider

`<SidebarFooter>` gets `className="border-t border-sidebar-border"`.
The `--sidebar-border` token is already defined in
`apps/web/app/globals.css` (it ships with the shadcn `Sidebar` install
and is consumed by other built-in sidebar styles), so per CLAUDE.md F4
this needs only a `grep` confirmation, not new CSS variables.

Alternatives considered: insert a shadcn `<Separator />` between
content and footer. Rejected — `border-t` on the existing
`SidebarFooter` reuses the element we already have and renders as a
true 1px hairline rather than the separator's slightly heavier visual
weight.

### D6. Persistence and SSE invalidation are unchanged

`memon:sidebar:expanded` localStorage, the `expanded: Set<string>`
state, and the hydration + pruning effects in the existing
`AppSidebar` body stay byte-for-byte the same. The query keys
(`['projects']`, `['experiments', project]`,
`['git-status', project]`, `['terminal','check']`) are unchanged, so
the existing SSE → cache-invalidation wires (in
`apps/web/components/query-invalidator.tsx`) continue to drive the
new UI without modification.

### D8. Active-experiment-row highlight: leading run-count badge replaces the indent gutter; wrapper covers everything

**Iterated post-apply across two rounds** — the first cut applied
the active highlight directly to the `<SidebarMenuButton>` via
its `isActive` prop, which painted everything including the
indent area and left the trailing "+" button floating. The second
cut wrapped the link + button in a single bg-painting container
with a separate transparent indent spacer outside it. The third
(current) cut drops the indent spacer entirely and folds its role
into a circular run-count badge that lives **inside** the link
as the row's leading visual:

```tsx
<SidebarMenuItem className="flex w-full items-center">
  {/* shared bg container: covers everything from leading badge to trailing Plus button */}
  <div className={cn(
    'flex min-w-0 flex-1 items-center rounded-md transition-colors',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'hover:bg-sidebar-accent/40',
  )}>
    <SidebarMenuButton
      asChild
      isActive={isActive}
      size="sm"
      className="min-w-0 flex-1
                 hover:bg-transparent data-[active=true]:bg-transparent"
    >
      <Link …>
        <span aria-label={`${count} runs`} className="size-[1.125rem] rounded-full bg-sidebar-foreground/5 text-[9px] tabular-nums text-sidebar-foreground/60">{count}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{exp.id}</span>
      </Link>
    </SidebarMenuButton>
    <ExpRowTerminalButton project={project} expId={exp.id} />
  </div>
</SidebarMenuItem>
```

Key moves:

- **Leading run-count badge replaces the indent gutter**. The
  badge plays two roles at once — it visually anchors the row's
  left edge (the role the transparent `<span aria-hidden
  className="w-6 shrink-0" />` previously played) AND surfaces
  the `runs.length` count as a passive numeric badge. A single
  visual element doing both jobs is denser than a separate
  spacer + a separately-rendered count, and matches VSCode's
  Explorer rows where the leading "kind" indicator (file / folder
  icon) is what sets the row's leading column.
- **Badge sits inside the link**. A click on the badge follows the
  same navigation as a click on the exp-id text — there's no
  "active gap" between the badge and the row's content. Because
  the badge is inside the wrapper, it also sits underneath the
  active-highlight background (the `bg-sidebar-foreground/5`
  fill on the badge is subtle enough to remain legible against
  both the resting body bg and the `bg-sidebar-accent` active
  bg).
- The wrapper `<div>` is the **single source of background truth**
  for the row. The inner `SidebarMenuButton`'s own bg paints are
  explicitly suppressed via `hover:bg-transparent` and
  `data-[active=true]:bg-transparent` so they don't compete with
  the wrapper. (cn() / tailwind-merge resolves the conflict by
  later-class-wins.)
- The wrapper extends across both the `<Link>`-rendered button
  (which contains both the badge and the exp-id) and the trailing
  `<ExpRowTerminalButton>`, so the active bg naturally reaches
  the right edge of the row including the "+" launcher.

We still pass `isActive` into `SidebarMenuButton` so the underlying
element keeps its `data-active="true"` attribute (which is used by
existing tests, by `aria-current`-equivalent semantics, and by any
nested `data-active`-keyed styling in the shadcn primitive). The
visual paint is taken over by the wrapper.

### D9. Banner height pinned to `h-7` (1.75rem) to match grid-row minimum exactly

The outer grid uses
`minmax(var(--sidebar-section-banner-h, 1.75rem), Nfr)` per row.
That `1.75rem` minimum MUST equal the banner's rendered height
exactly — if the banner were taller than the minimum, closed rows
would have visible content but the row would still be pinned at
1.75rem and clip; if the banner were shorter, closed rows would
have visible empty space below the banner.

We therefore pin the banner to `h-7` (Tailwind's `1.75rem` =
28px) instead of `h-auto`. Trade-off: any banner-style change
that wants more / less vertical space (taller padding, a second
line of text, a top-row badge) MUST also update the
`--sidebar-section-banner-h` CSS variable in lockstep, or update
both the class and the grid template. A short comment in
`app-sidebar.tsx` next to both the banner class and the grid
template flags this coupling for future editors.

We pick `h-7` (28px) rather than `h-6` (24px) or `h-8` (32px) for
density: 28px matches the visual cadence of one body row (with
`text-xs` ≈ 12px line + tight padding) and reads as a banner
rather than a body row, without consuming too much vertical
space.

### D10. Loading spinner only on first fetch — TanStack cache handles the rest

When a project section is first opened, the
`['experiments', project]` query has no cached data. To avoid
showing an empty-looking section body during the fetch (which the
user would mistake for "no experiments"), the body renders a
small centered `<Loader2 />` spinner.

Once the query resolves, TanStack Query caches the result by key.
Closing and re-opening the section returns the cached array
immediately while a background refetch runs; the user sees the
rows without flicker. The condition for showing the spinner is
therefore `enabled && isLoading && docs.length === 0` — guarding
against the cached-but-refetching case so the spinner shows only
on the cold path.

Alternatives considered:

- **Skeleton rows** (Skeleton component from shadcn). Rejected:
  the experiment list's row count is unknown until the query
  resolves, so we'd have to render an arbitrary fixed number of
  skeletons (3? 5?). A spinner is fewer DOM nodes and reads as
  unambiguous "loading".
- **No spinner, just nothing**. Rejected: the open section
  renders at its full grid-share height before the query
  resolves; an empty body for ~100-300 ms reads as "this project
  has no experiments". The spinner pre-empts that
  misinterpretation.

### D11. Git pill click opens a project-scoped GitDiffDialog (NOT a tooltip)

**Iterated post-apply** — the first cut wired the pill click to
focus the pill, letting Radix Tooltip's focus-based open path
surface the existing inline tooltip (which shows branch /
ahead-behind / dirty counts). The user surfaced two problems:

1. **Touch users have no focus-on-tap**. On iOS / Android the
   inline tooltip never opened on touch. The "click → tooltip"
   contract worked only for keyboard users.
2. **The tooltip surface is too small for branch context**. Users
   wanting to see the diff actually wanted to see the
   files-changed list and per-file diff content, not just the
   summary counts the tooltip already shows on hover.

The new contract: a click on the pill opens a project-scoped
`<GitDiffDialog>` (a richer surface mounted at `<AppSidebar>`
level, keyed by `diffDialogProject` state). The dialog uses the
existing `/api/projects/:project/git-status-files` and
`/api/projects/:project/git-diff` endpoints to surface staged /
unstaged / untracked files plus per-file diff content. The
hover-only inline tooltip is unchanged — it remains the
"summary on hover" affordance; the click is the "detail on
demand" escalation.

Implementation: a `<span role="button" tabIndex={0}>` wraps the
pill, intercepting `onClick`, `onPointerDown`, and `onKeyDown`
(Enter / Space). Each handler calls `e.preventDefault() +
e.stopPropagation()` and invokes a parent-supplied
`onPillClick(project)` callback. `AppSidebar` keeps the
`diffDialogProject: string | null` state and renders a single
`<GitDiffDialog>` instance keyed to whichever project is open
(or `null` for closed). Only one dialog instance for the whole
sidebar regardless of how many projects.

Trade-off: clicks on the pill don't open the hover tooltip
anymore. We accept this — hover still works for mouse users, and
the dialog is a strictly richer affordance for the "wanted more
info" case. Touch users get the dialog as their primary path
into pill-detail; that's a strict improvement over the old
"no path" state.

Non-git projects render the bare pill with no wrapper, so non-git
rows behave like before (clicking anywhere in the header,
including over the empty pill region, toggles the section).

### D7. Why not a separate per-experiment hover-revealed action menu?

VSCode reveals row-level actions on hover. We considered the same
treatment (chevron + ... menu containing "Open shell", "Open
Claude Code", "Copy path"). Rejected for v1 because:

- Hover-only controls fail for keyboard / touch users.
- Discoverability: a permanently-visible icon button gets noticed.
- Scope: the user explicitly asked for one button, not a menu.
- We can promote the icon to a menu in a follow-up if more actions
  arrive without breaking this change's contract.

## Risks / Trade-offs

- **[Layout regression: section headers wrap on narrow sidebar widths]**
  → The chevron + uppercase name + git pill can collide when the
  sidebar's width is at its minimum. Mitigation: the existing
  `truncate` on the project name span, plus `max-w-[8rem]` on the
  pill, plus `min-w-0` propagation through the flex column, keeps
  the row to a single line. If a project name + dirty-branch combo
  still wraps on the tightest viewport, fall back to truncating the
  branch label further (the pill already truncates to 18 chars).
- **[Long experiment lists slow first paint]** → Removing the 5-item
  cap means a project with 100 experiments renders 100
  `<SidebarMenuItem>`s on expand. In practice projects sit ≤ ~50
  active experiments and React's reconciliation is fast at that
  scale. If profiling shows a problem we can add virtualization
  inside the `overflow-y-auto` container as a follow-up.
- **[ttyd missing → terminal button renders disabled across all rows]**
  → The probe runs once per session (TanStack `staleTime: 10_000`),
  shared across all rows. When ttyd is absent, every section row
  renders a disabled icon with a tooltip. This is consistent with
  the existing `TerminalButton`'s behavior on experiment pages.
- **[Click bleed: clicking the icon button accidentally navigates the
  experiment link]** → The icon button sits inside a `<Link>`-wrapped
  `<SidebarMenuButton asChild>`. We mitigate by lifting the icon
  button out of the `<Link>` (sibling to it, both inside the row's
  flex container) AND stopping propagation on the icon's `onClick`
  for defence in depth.
- **[Header click target shrinks because chevron + uppercase name take
  less width]** → The whole `CollapsibleTrigger` row remains the
  click target (flex-row with `w-full`). The text content shrinks
  but the click area does not.
- **[Multi-expand with many sections → each gets too little
  height]** → If the user expands all 8 projects, each section gets
  `(viewport - 8×header) / 8` of body height. Acceptable: each
  section is still scrollable internally, and the user can collapse
  what they don't need. We do not add an artificial max-N-expanded
  limit.

## Migration Plan

Pure additive UI restructure — no on-disk artifacts, no API contract
changes, no migration step.

- Deploy → reload restores `memon:sidebar:expanded` and renders the
  new layout. Users with stale `localStorage` see the same set of
  sections open as before; nothing to reset.
- Rollback → revert the change set. `localStorage` keys are
  compatible across the new and old shapes (the data is just a list
  of project names).

## Open Questions

- **Should the section header carry a project-level action affordance
  (e.g. a "..." menu on hover)?** Deferred. For v1 the header is
  click-to-toggle only. If the answer turns out to be "yes," it
  becomes a follow-up change that adds the affordance as a hover-only
  control next to the git pill.
- **Should the per-row terminal button reuse the existing
  `TerminalSheet` (single sheet at a time, mounted per row) or a
  shared single `TerminalSheet` mounted at sidebar root and
  parameterized by the currently-open row?** Defaulting to per-row
  for v1 to keep the change shape small; the per-row sheet mounts
  only when its `open` state flips true, so the cost of N idle sheets
  is N small components with `open={false}`. If profiling shows a
  problem, hoist to a shared sheet in a follow-up.
