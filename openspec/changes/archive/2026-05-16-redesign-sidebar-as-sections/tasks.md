## 1. Section header layout

- [x] 1.1 In `apps/web/components/app-sidebar.tsx`, restructure the
      `ProjectGroup` component's `<SidebarGroupLabel><CollapsibleTrigger>`
      body so its child order becomes:
      `<ChevronDown />` (left), uppercase project-name span (middle),
      `<GitStatusPill ... className="ml-auto ..." />` (right).
- [x] 1.2 Apply class
      `text-xs font-semibold uppercase tracking-wider truncate` to the
      project-name span (no `font-mono`). Keep `isActive &&
      text-sidebar-primary` highlight.
- [x] 1.3 Apply chevron classes
      `size-3.5 shrink-0 transition-transform -rotate-90
       group-data-[state=open]/collapsible:rotate-0` to the
      `<ChevronDown />` icon so it points right when collapsed and
      down when expanded.
- [x] 1.4 Confirm the pill receives `ml-auto max-w-[8rem]
      overflow-hidden` (it already had similar overflow classes;
      `ml-2` is replaced by `ml-auto`).
- [x] 1.5 Visual check: clicking anywhere in the header row (chevron,
      name span, gap, but NOT on the pill's tooltip trigger) still
      toggles expand/collapse. The pill is rendered inside the
      trigger but is not itself a button/link.

## 2. Multi-expand even-height distribution

- [x] 2.1 Leave `<SidebarContent>`'s className alone — the shadcn
      primitive already supplies `flex min-h-0 flex-1 flex-col` which
      is the canonical "fill remaining space between header and
      footer" pattern. (An earlier cut overrode with `h-full` to
      "fill the parent height"; that was a bug — `h-full` makes
      SidebarContent claim 100% of the sidebar, leaving header /
      footer no room. The bottom expanded section ran past the
      footer divider. Fixed by removing the override.)
- [x] 2.2 For each `<SidebarGroup>` rendered in the `projects.map`,
      apply conditional classes based on `isOpen`:
      - Expanded: `flex min-h-0 flex-1 flex-col py-0`
      - Collapsed: `flex-none py-0`
- [x] 2.3 Apply `flex-1 min-h-0 overflow-y-auto` to the
      `<CollapsibleContent>` element (or to the
      `<SidebarGroupContent>` inside it, whichever ends up being the
      flex-direct-child that owns the scroll).
- [x] 2.4 Manual layout check: with 0, 1, 2, and 3+ sections expanded,
      verify each expanded section receives roughly equal share of
      the available vertical space and that long lists scroll inside
      the section, not the whole sidebar.

## 3. Remove "View more" cap and show all experiments

- [x] 3.1 In `ProjectExperimentDocs`, delete:
      - the `DEFAULT_VISIBLE = 5` constant,
      - the local `showAll: boolean` state,
      - the `visible = showAll ? sorted : sorted.slice(0, DEFAULT_VISIBLE)`
        slicing,
      - the `hasMore` calculation,
      - the trailing `<SidebarMenuItem>` that renders the "View more
        (N) / Show fewer" button.
- [x] 3.2 Render `sorted.map(...)` directly (or rename `sorted` to
      `visible` if helpful).
- [x] 3.3 Confirm `sorted` still filters out archived experiments
      and sorts by `effectiveUpdatedAt` descending — these stay.

## 4. Experiment row layout: left indent + per-row terminal button

- [x] 4.1 Apply `pl-6` (or the closest equivalent that visually
      indents the row content under the project name in the header)
      to each experiment row's `<SidebarMenuButton>` or its inner
      `<Link>`. Verify the indent matches the chevron-column width.
- [x] 4.2 Add a new colocated subcomponent in `app-sidebar.tsx` —
      e.g. `ExpRowTerminalButton({ project, expId })` — that:
      - reads `useSession().role` and returns `null` for viewers,
      - reads `useQuery({ queryKey: ['terminal','check'], queryFn:
        checkTerminal, staleTime: 10_000, enabled: role === 'owner' })`,
      - manages a local `sheetOpen` state,
      - renders a `<Button variant="ghost" size="icon"
        className="size-6">` containing `<Terminal className="size-3.5" />`,
      - is disabled (with a tooltip surfacing `probe.suggestion ??
        "ttyd unavailable"`) when the probe reports
        `available: false` (mirror `TerminalButton`'s State C),
      - on click, calls `e.stopPropagation()` (to avoid navigating
        the surrounding `<Link>`) and toggles the sheet open,
      - mounts a `<TerminalSheet>` with the new
        `{ project, scope: 'exp', slug: expId, agent: 'none' }`
        shape.
- [x] 4.3 Update `apps/web/components/terminal-sheet.tsx` to accept
      EITHER the legacy `{ runId, projectName }` props OR a new
      explicit `{ project, scope, slug, agent }` quartet. Keep the
      legacy path defaulting to `agent: 'claude'` and `scope: 'run'`
      so `experiment-detail.tsx`'s usage is unchanged.
- [x] 4.4 In the row, render the icon button as a sibling of the
      `<SidebarMenuButton asChild><Link>...</Link></SidebarMenuButton>`,
      not nested inside the link. The row wrapper (`<SidebarMenuItem>`
      or a new flex container inside it) holds both. Make sure
      `<SidebarMenuItem>`'s default styles still apply to the link
      portion of the row.
- [x] 4.5 Confirm the runs-count number (`exp.frontMatter.runs.length`)
      still renders, and sits between the exp-id span and the new
      terminal icon button.

## 5. Footer divider

- [x] 5.1 Add `className="border-t border-sidebar-border"` to the
      `<SidebarFooter>` element in `app-sidebar.tsx`.
- [x] 5.2 Per CLAUDE.md F4, `grep` `apps/web/app/globals.css` for the
      `--sidebar-border` token. The token MUST already exist (it
      shipped with the shadcn sidebar install); do NOT add a new
      definition. If grep finds no match, stop and resolve the
      missing token before continuing.

## 6. Tests

- [x] 6.1 Update or add to `apps/web/components/app-sidebar.test.tsx`
      (or create one if absent) tests that cover:
      - Header child order: chevron, uppercase name, then pill with
        `ml-auto`.
      - Header name span carries an uppercase-resolving class.
      - With 12 experiments mocked, all 12 rows render (no "View
        more" markup is present in the tree).
      - Owner session: terminal icon button is present on each
        experiment row.
      - Viewer session: no terminal icon button is rendered.
      - ttyd unavailable: terminal icon button is rendered disabled
        with a tooltip carrying the probe `suggestion`.
- [x] 6.2 Confirm `pnpm --filter @memon/web test` is green.
- [x] 6.3 Confirm `pnpm --filter @memon/web typecheck` is clean.

## 7. End-to-end verification (CLAUDE.md F1 + F4 protocol)

Per `CLAUDE.md`'s "Verification protocol for UI changes": a UI change
is NOT done until the rendered HTML AND the compiled CSS prove the
new structure is present.

- [x] 7.1 Read owner Basic credentials from `config.yml`:
      `MEMON_USER=$(grep -E '^\s*username:' config.yml | sed -E
       's/.*: *"?([^"]+)"?$/\1/' | head -1)`
      `MEMON_PASS=$(grep -E '^\s*password:' config.yml | sed -E
       's/.*: *"?([^"]+)"?$/\1/' | head -1)`
- [x] 7.2 Restart prod build per CLAUDE.md "Dev: prefer prod build"
      sequence (kill the old `:3737` PID first, optionally
      `rm -rf apps/web/.next`, then `pnpm --filter @memon/web build`
      then `cd apps/web && pnpm start > /tmp/memon-prod.log 2>&1 &`).
- [x] 7.3 Curl a project page that has multiple experiments:
      `curl -sS -u "$MEMON_USER:$MEMON_PASS"
       http://localhost:3737/p/<a-project>` and grep the served HTML
      to confirm:
      - the new header structure markup is present (chevron icon
        with `-rotate-90`, uppercase name span class set
        `truncate text-xs font-semibold uppercase tracking-wider`),
      - footer carries `border-t border-sidebar-border`,
      - no "View more" text is present in the page.
      Note: experiment-row markup (per-row terminal icon, pl-6 indent,
      `git-status-pill-compact` data slot) is client-rendered after the
      TanStack queries resolve; not visible in initial SSR output.
      Covered instead by the unit tests in section 6 (owner sees icon,
      viewer does not, disabled with tooltip when ttyd unavailable).
- [x] 7.4 Curl the compiled CSS bundle:
      `curl -sS
       "http://localhost:3737/_next/static/css/app/layout.css?v=$(date +%s)"`
      and confirm every semantic token used by the new layout has a
      CSS variable in `:root`. At minimum: `--sidebar-border`,
      `--sidebar-foreground`, `--sidebar-accent`,
      `--sidebar-accent-foreground`, `--sidebar-primary`. All present
      (light + dark variants); `border-color:var(--sidebar-border)`
      resolves correctly in the compiled bundle.
- [x] 7.5 Sanity-check the API call shape. The new
      `ExpRowTerminalButton` mounts a `<TerminalSheet>` with explicit
      props `project={p}, scope="exp", slug={expId}, agent="none"`.
      `TerminalSheet`'s normalized `startTerminal` call thus carries
      exactly `{ project, scope: 'exp', slug, agent: 'none' }` — the
      legacy `runId`/`projectName` shape (which would default to
      `agent: 'claude'`) is NOT taken because the explicit props are
      passed. Covered by the discriminated union in
      `terminal-sheet.tsx`.
- [x] 7.6 Viewer session: `ExpRowTerminalButton` returns `null` when
      `useSession().role === 'viewer'` (defence in depth on top of
      the server-side owner-only `/api/terminal/start` enforcement).
      Covered by the "viewer: no terminal icon button is rendered on
      rows" unit test in `app-sidebar.test.tsx`. Browser-share-URL
      manual verification deferred to release smoke (not a structural
      gate).
- [x] 7.7 Multi-expand structure verified via SSR HTML:
      `SidebarContent` resolves to the shadcn default
      `flex min-h-0 flex-1 flex-col` (sibling-aware — leaves
      SidebarHeader and SidebarFooter their slots; the earlier
      `h-full` override was removed because it pushed the bottom
      expanded section past the footer), and expanded `SidebarGroup`
      resolves to
      `relative w-full min-w-0 px-2 py-0 flex min-h-0 flex-1 flex-col`,
      so flex math distributes height evenly. The `CollapsibleContent`
      inside expanded sections has `flex-1 min-h-0 overflow-y-auto`,
      so long lists scroll inside the section, not the whole sidebar.
- [x] 7.8 `openspec validate redesign-sidebar-as-sections --type
      change` is clean.

## 8. Post-apply visual iteration (banner / Plus / active-row highlight)

After the initial apply, owner visual review surfaced four refinements
that landed before archive:

- [x] 8.1 Remove the chevron indicator from the section header
      (`ChevronDown` JSX + its import). The new banner styling (D1)
      replaces it as the affordance signal.
- [x] 8.2 Add banner styling to `<SidebarGroupLabel>`:
      `border-y border-sidebar-border bg-sidebar-accent/40 px-2 py-1
      h-auto` so each project's header reads as a tinted bracketed
      banner instead of a plain row of text.
- [x] 8.3 Shrink the project name from `text-xs` to `text-[10px]` and
      add `min-w-0 flex-1` so the name truncates first when space
      runs out (giving the git pill width-priority).
- [x] 8.4 Drop `max-w-[8rem] overflow-hidden` from the git pill's
      wrapper className; add `shrink-0`. Long branch info now displays
      in full; the project name is what truncates to ellipsis.
- [x] 8.5 Swap the per-row launcher icon from `Terminal` to `Plus`.
      Update both the available and the disabled `aria-label` strings
      from `"Open shell for …"` to `"New terminal for …"`. Update
      the import in `app-sidebar.tsx` accordingly.
- [x] 8.6 Restructure the experiment row so the active-state highlight
      excludes the leading indent gutter and covers the trailing `+`
      button (D8): leading `<span aria-hidden className="w-6
      shrink-0" />` replaces `pl-6`; both `<SidebarMenuButton>` and
      `<ExpRowTerminalButton>` sit inside a single bg-painting
      wrapper `<div>` whose `bg-sidebar-accent` is the single source
      of background truth (inner button bg is suppressed with
      `hover:bg-transparent data-[active=true]:bg-transparent`).
- [x] 8.7 Update `app-sidebar.test.tsx`: rewrite the "header child
      order" test to assert no chevron, banner classes present, name
      with `min-w-0 flex-1 truncate`, pill with `shrink-0` and no
      width cap; update three `aria-label` regexes from
      `Open shell for …` to `New terminal for …`.
- [x] 8.8 Sync `specs/web-layout/spec.md` (rewrite the header-layout
      requirement, add the active-row-highlight requirement, amend
      the indent scenario, swap Terminal→Plus and aria-label
      wording in the terminal-button requirement + scenarios).
- [x] 8.9 Sync `design.md`: D1 rewritten (banner replaces chevron;
      name yields width); D4 rewritten (Plus icon + aria-label
      framing); new D8 (active-row highlight architecture with
      indent spacer + bg-painting wrapper).

## 9. Pill click should pop the tooltip, not collapse the section

- [x] 9.1 In `apps/web/components/git-status-pill.tsx`,
      `CompactPill`'s outer span gets `tabIndex={0}` and
      `onClick={(e) => e.stopPropagation()}`, plus a focus-visible
      ring (`outline-none focus-visible:ring-2 focus-visible:ring-ring
      rounded-sm cursor-pointer`). This makes the pill keyboard-
      focusable, prevents clicks from bubbling to the surrounding
      `CollapsibleTrigger`, and (via focus) opens the existing
      tooltip on click for touch / mouse-tap users.
- [x] 9.2 Sync the spec: amend "Sidebar sections use a VSCode-
      Explorer-style banner header" — the click-everywhere rule now
      excludes the pill, with a new scenario for the click-to-popup
      behavior.
- [x] 9.3 Tests: existing `app-sidebar.test.tsx` and
      `git-status-pill.test.tsx` continue to pass without
      modification (21/21).

## 10. Final architecture iteration after multi-expand bug surfaced

Post-apply visual review surfaced a multi-expand layout bug
(banner compression under overflow + snap-jump animation) and a
follow-up batch of UX refinements. The fixes are large enough to
record as a separate section here:

- [x] 10.1 Replace the flex multi-expand on `<SidebarContent>`
      with a CSS Grid + `minmax(var(--sidebar-section-banner-h, 1.75rem), Nfr)`
      row-template. `!grid !overflow-hidden` overrides shadcn's
      flex default; `gridTemplateRows` is computed from the
      `expanded` set, with `0fr` for closed rows and `1fr` for
      open rows. See D2 (rewritten) for rationale. The earlier
      `flex min-h-0 flex-1 flex-col` per-section toggle on the
      `<Collapsible>` wrapper is gone; the wrapper now carries
      only `flex min-h-0 flex-col overflow-hidden` (one grid row
      of the outer grid).
- [x] 10.2 Pin the banner to `h-7` (1.75rem = 28px) — matches the
      grid-row `minmax(1.75rem, …)` minimum exactly. Update
      `<SidebarGroupLabel>`'s class from `h-auto` to `h-7`.
- [x] 10.3 Deepen the banner background from `bg-sidebar-accent/40`
      → `bg-sidebar-accent/60` per owner visual review. The earlier
      `/40` was too pale against the redesigned resting layout.
- [x] 10.4 Add `-mx-2 text-left rounded-none` to the banner so it
      extends edge-to-edge inside the sidebar column (offsetting
      the parent `<SidebarGroup>`'s `px-2`), sits flush-left
      instead of centered (override the native button default),
      and drops shadcn's default rounded corners (rounded corners
      on an edge-to-edge banner look wrong).
- [x] 10.5 Add a `transition-[grid-template-rows] duration-200
      ease-out` class to `<SidebarContent>` so opening / closing
      a section animates every row's height simultaneously over
      ~200ms. Chrome 121+ / Firefox 117+ natively interpolate the
      `fr` component of `minmax(<length>, Nfr)`; older browsers
      jump but layout stays correct on every keyframe.
- [x] 10.6 Drop Radix's `animate-collapsible-down/up` keyframes
      on `<CollapsibleContent>`. The Radix keyframes set
      `height: 0 → var(--radix-collapsible-content-height)` per
      section, which fights the outer grid's row sizing and
      produces a snap at keyframe end. `<CollapsibleContent>`
      now just carries `flex-1 min-h-0 overflow-hidden` with
      `forceMount` so Radix `display: none`s it when closed but
      the element stays in the DOM. Inside, a
      `<div className="h-full overflow-y-auto">` handles internal
      scroll.
- [x] 10.7 Replace the leading transparent indent gutter
      (`<span aria-hidden className="w-6 shrink-0" />`) with a
      circular run-count badge that lives **inside** the link as
      the row's leading visual. Badge is `size-[1.125rem]`
      (18px) `rounded-full bg-sidebar-foreground/5 text-[9px]
      tabular-nums text-sidebar-foreground/60` with
      `aria-label="<N> runs"`. See D8 (rewritten) and the new
      "Experiment row leading run-count badge replaces the
      indent gutter" spec requirement.
- [x] 10.8 Add a `<Loader2 className="size-4 animate-spin">`
      spinner in `ProjectExperimentDocs` for the first-fetch
      state (`enabled && isLoading && docs.length === 0`).
      Rendered inside a `<div data-slot="exp-list-loading">`.
      TanStack Query's cache handles the stale-while-revalidate
      case automatically — `docs.length > 0` skips the spinner
      branch. See the new "Loading spinner shows when section
      first opens" spec requirement.
- [x] 10.9 Switch the git pill click contract from
      "focus → open the inline tooltip" to "click → open a
      project-scoped `<GitDiffDialog>`". A
      `<span role="button" tabIndex={0}>` wrapper around the
      pill intercepts `onClick` / `onPointerDown` / `onKeyDown`
      (Enter/Space), calls `preventDefault + stopPropagation`,
      and invokes a parent-supplied `onPillClick`. `<AppSidebar>`
      keeps `diffDialogProject` state and mounts a single
      `<GitDiffDialog>` instance for whichever project is open.
      Non-git projects render the bare pill with no wrapper. See
      D11 (new) and the rewritten "click on the git pill"
      scenarios.
- [x] 10.10 Confirm `<SidebarContent>` h-full removal from §2.1
      is still in force — the grid layout still needs to leave
      `<SidebarHeader>` and `<SidebarFooter>` their slots, and
      `flex-1` (kept on `<SidebarContent>` from the shadcn
      default that we no longer override on that axis) still
      does that work in combination with the outer
      `<SidebarProvider>`'s flex column.
- [x] 10.11 Sync `specs/web-layout/spec.md`: rewrite the
      "Sidebar sections distribute available vertical space
      evenly when multiple are expanded" requirement to the new
      "CSS Grid row-template" + "Section expand/collapse height
      animation" pair; add the leading run-count badge
      requirement; add the loading-spinner requirement; rewrite
      the banner header requirement with the new
      bg/`-mx-2`/`rounded-none`/`text-left`/`h-7` constraints;
      rewrite the "click on the git pill" scenarios for the
      dialog contract; rewrite the active-row-highlight
      requirement to drop indent-gutter language and reference
      the leading badge.
- [x] 10.12 Sync `design.md`: D2 fully rewritten (CSS Grid); D1
      updated with banner contract details; D8 rewritten (badge
      inside link); add D9 (banner h-7), D10 (loading spinner),
      D11 (git pill → diff dialog).
- [x] 10.13 Update `apps/web/components/app-sidebar.test.tsx`:
      new tests assert (a) the pill-trigger wrapper exists for
      git-enabled projects with `data-slot="git-status-pill-trigger"`,
      (b) clicking the trigger opens a
      `[data-slot="git-diff-dialog"]` element without closing
      the parent section, (c) non-git projects render the bare
      pill without a wrapper.
