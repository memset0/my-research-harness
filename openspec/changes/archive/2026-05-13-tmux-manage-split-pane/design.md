## Context

`/manage/tmux` is the host-level inventory of `memon-*` tmux sessions.
Today it's a wide table; opening a session uses either an overlay
drawer (`useTerminalDrawer().open(...)`) or a popup window
(`window.open('/terminal-popup?...', ...)`). The just-shipped
`attach-tmux-by-name` change added an `openRaw({ sessionName })` path
for manual rows alongside the standard `open({ project, scope, slug,
agent })` path. Both code paths converge on the same `<TerminalView>`
component, branched on a discriminated `mode: 'standard' | 'raw'` prop.

This change pulls the terminal out of the overlay drawer and into the
page itself as a right-hand pane, with the session list living on the
left. The split is resizable. The drawer button per row goes away.
The global `TerminalDrawerProvider` stays mounted (other pages still
use it via `<OpenWithButton>` on run/exp detail pages).

## Goals / Non-Goals

**Goals:**

- One-click session switching: click a row, the terminal pane
  reattaches to that session.
- Visual parity between matchable and manual rows — both render the
  same card layout, just with different inline badges and different
  underlying `start` vs `attach` API call.
- Persist selection in the URL so refresh, paste-link, and "open in
  new tab" all work.
- Persist pane sizes in localStorage so the user's preferred split
  survives reloads.
- Strip noisy common prefixes (`memon-`, `memon-manual-`, etc.) from
  the title and surface the categorization as a colored badge instead.
- Reuse 100% of the existing terminal stack: `<TerminalView>` (and
  thus `POST /api/terminal/start` + `POST /api/terminal/attach`)
  works as-is; only the layout shell changes.

**Non-Goals:**

- Touch the global `TerminalDrawerProvider`, `<TerminalView>`, the
  terminal manager, the popup route, or any backend endpoint. The
  layout change is purely client-side and purely scoped to
  `apps/web/app/manage/tmux/`.
- Add a sessionName free-text filter, sort controls, or column
  customization. The existing filter tabs (`All` / `Active` / `Stale`)
  stay.
- Multi-pane terminals (split the right pane further). One terminal
  visible at a time — popup is still the answer if you need two
  simultaneously.
- Touch any spec capability other than `tmux-session-management`.

## Decisions

### D1. Use shadcn `Resizable` (react-resizable-panels)

shadcn ships a `Resizable` recipe at
<https://ui.shadcn.com/docs/components/resizable> built on
`react-resizable-panels`. It exposes `ResizablePanelGroup` (sets the
direction), `ResizablePanel` (panes), and `ResizableHandle` (the
draggable divider, with an optional `withHandle` prop for the grip
indicator). This is the canonical primitive — installing it is a
single command:

```bash
pnpm dlx shadcn@latest add resizable --yes
```

Per CLAUDE.md F2, the project's `components.json` is a real shadcn
init (`style: "radix-mira"`, `baseColor: "mist"`), so the
non-interactive `add` form is safe — it won't try to fabricate theme
tokens.

**Alternatives considered:**

- Hand-rolled drag handle with `pointerdown` + `pointermove` listeners.
  Rejected: keyboard accessibility (arrow keys to resize), focus
  handling, and ARIA roles are non-trivial; react-resizable-panels
  does these.
- CSS-only `grid-template-columns: minmax(...)` with no drag.
  Rejected: user explicitly asked for a draggable divider.

### D2. Orientation: horizontal on `md+`, vertical on `<md`

The same `ResizablePanelGroup` is reused with `direction` flipped
based on viewport. Use a `useMediaQuery` hook (or pure CSS via two
mirrored `Hidden` siblings, but a hook is simpler with
react-resizable-panels) keyed to the Tailwind `md` breakpoint (768px).

```ts
const isDesktop = useMediaQuery('(min-width: 768px)')
return (
  <ResizablePanelGroup direction={isDesktop ? 'horizontal' : 'vertical'} ...>
    <ResizablePanel ...>list</ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel ...>terminal</ResizablePanel>
  </ResizablePanelGroup>
)
```

The hook returns `false` on SSR — to avoid a flash, the parent server
component renders both panes inside a wrapper that defaults to the
vertical (mobile-first) layout, and the client hook switches to
horizontal as soon as it hydrates. This matches existing patterns in
the repo (e.g. responsive sidebar in `app-sidebar.tsx`).

### D3. Selection lives in the URL: `?session=<sessionName>`

Selection is reflected as a query param so it survives refresh, can be
deep-linked, and behaves correctly with the back/forward buttons.

- Reading: `useSearchParams().get('session')`. Validate against the
  current session list (drop the param if the named session is no
  longer in the list, e.g. after a Kill).
- Writing: `router.replace(...)` (not `push`) so each selection
  doesn't pollute history — only meaningful navigations push.

If the URL has no `?session=`, no row is selected initially and the
right pane shows the empty state. We intentionally do NOT auto-select
the most-recent session — auto-attaching the user's terminal on every
page visit would surprise them.

**Alternatives considered:**

- URL hash (`#<sessionName>`). Rejected: hash is ergonomic for
  same-page anchors but query params are the standard for state and
  TanStack's `useSearchParams` is already loaded.
- React state only (no URL). Rejected: loses on refresh, can't
  share a deep link with a teammate ("open this session for me").
- Path segment (`/manage/tmux/<sessionName>`). Rejected: requires a
  dynamic route and a separate page.tsx — extra ceremony for no extra
  benefit, and sessionNames have special chars that need encoding.

### D4. Pane sizes in localStorage: key `memon:manage-tmux:split-sizes`

`react-resizable-panels` exposes the panels' size as `number[]` via
the `onLayout` callback on `ResizablePanelGroup`. Persist on each
debounced layout change; restore on mount as the panel group's
`defaultSize` per child.

```ts
const [sizes, setSizes] = useLocalStorageState<Record<string, number>>(
  'memon:manage-tmux:split-sizes',
  isDesktop ? { 'tmux-list': 33, 'tmux-terminal': 67 } : { 'tmux-list': 50, 'tmux-terminal': 50 },
)
```

Defaults: **1:2 on desktop** (33/67 — terminal gets two-thirds, list one-third) and **1:1 on mobile** (50/50 — equal split top/bottom).
The map is keyed by panel `id` because `react-resizable-panels` v4 uses
`defaultLayout: { [panelId]: number }` rather than the v3 `number[]`.

Two separate keys for the two orientations would also work; the
single-key approach risks restoring a desktop-style split on a freshly
rotated phone, but the user can drag once and the new sizes get saved.
Single key keeps the impl simpler — accept the tiny first-visit
awkwardness on cross-orientation reuse.

### D5. Right-pane terminal via existing `<TerminalView>`, keyed on sessionName

The right pane renders the existing `<TerminalView>` component with
either standard or raw props depending on the selected row's
matchability:

```tsx
selected.row.matchable ? (
  <TerminalView
    mode="standard"
    project={...}
    scope={...}
    slug={...}
    agent={...}
    key={sessionName}
  />
) : (
  <TerminalView mode="raw" sessionName={sessionName} key={sessionName} />
)
```

The `key={sessionName}` triggers a fresh mount when the user picks a
different row, which:

1. Cleans up the previous iframe (`<TerminalView>` already has the
   teardown effect — switching `key` unmounts → that effect's cleanup
   runs).
2. Re-runs the start/attach effect for the new sessionName.

`<TerminalView>` already handles the loading state, error state, and
"reattach" affordance. Nothing inside the component needs to change.

### D6. Stale rows are render-only — body click does NOT select

Stale rows (`staleReason !== null`) keep their existing behavior:
Kill-only action, no terminal open. The card body becomes
non-interactive (`tabIndex={-1}`, no click handler, no selected state
styling). This is consistent with the existing
`manage-tmux-stale-no-open` decision — opening stale sessions
surfaces confusing fallback warnings.

Visual treatment: the card renders with `opacity-75` and the category
badge is `legacy`-muted-style regardless of parsed scope; the inline
`⚠ stale (<reason>)` indicator replaces the target link.

### D7. Page height: full-bleed inside `<SidebarInset>`

The `<SidebarInset>` is `flex-1` (set in `app/manage/layout.tsx`).
For `ResizablePanelGroup` to compute relative sizes, its parent must
have a definite height. We add `flex-1 min-h-0` to the `<SidebarInset>`
child wrapper (already there as `<div className="flex-1">{children}</div>`,
just add `min-h-0`) and have the tmux page render its own
`<div className="flex h-full flex-col">` shell. The page wrapper's
existing `mx-auto max-w-[1400px] p-6` is dropped — full-bleed.

Side effect: other `/manage/*` pages (none currently exist) won't get
a default max-width either. That's fine; they can opt-in by wrapping
their page contents in a centered container.

### D8. Drawer remains mounted; only `/manage/tmux`'s usage of it goes

`apps/web/components/providers.tsx` keeps mounting
`<TerminalDrawerProvider>` at the root. `useTerminalDrawer()` is still
called by `apps/web/components/open-with-button.tsx` (run/exp page
action bar) — that path stays untouched.

`apps/web/app/manage/tmux/tmux-page.client.tsx` loses its
`useTerminalDrawer()` call entirely. The `Drawer` button per row is
removed. The `Popup` button still calls `window.open(popupUrl(row),
...)` exactly as it does today — popup is the cross-context handoff
that the new inline pane doesn't replace.

### D9. Category badge: prefix-strip + colored chip

Helper function that takes a `TmuxSessionRow` and returns
`{ category: 'manual' | 'run' | 'exp' | 'project' | 'legacy' | null, title: string }`:

```ts
function categorize(row: TmuxSessionRow): {
  category: 'manual' | 'run' | 'exp' | 'project' | 'legacy' | null
  title: string
}
```

Algorithm:

1. Strip the leading `memon-` from `row.sessionName` (always present
   per the GET-list filter). Call the residue `r`.
2. For each candidate prefix in `['manual-', 'project-', 'exp-', 'run-']`:
   if `r` starts with it, strip it and set the category to that token
   (without the trailing `-`). Return `{ category, title: r-after-strip }`.
3. Otherwise: if `row.parsed.scope === 'run'`, return
   `{ category: 'run', title: r }`. If `'exp'`, return
   `{ category: 'exp', title: r }`. If `row.parsed.legacy`, return
   `{ category: 'legacy', title: r }`.
4. Otherwise: return `{ category: null, title: r }`.

The literal-prefix step (2) is the user's explicit ask. Today only
`manual-` matches anything, but `project-` / `exp-` / `run-` are
included so the rule is forward-compatible if the naming scheme ever
adds those.

The category badge component renders a small chip with
category-specific Tailwind classes (`bg-amber-100 text-amber-900` for
manual on light, etc.). Colors:

| category | light bg/fg                           | dark bg/fg                          |
|----------|---------------------------------------|-------------------------------------|
| manual   | `bg-amber-100 text-amber-900`         | `dark:bg-amber-900/40 dark:text-amber-200` |
| run      | `bg-emerald-100 text-emerald-900`     | `dark:bg-emerald-900/40 dark:text-emerald-200` |
| exp      | `bg-sky-100 text-sky-900`             | `dark:bg-sky-900/40 dark:text-sky-200` |
| project  | `bg-violet-100 text-violet-900`       | `dark:bg-violet-900/40 dark:text-violet-200` |
| legacy   | `bg-muted text-muted-foreground`      | (same — already adaptive)            |

Using the project's existing `<WarningBadge>` / `<SuccessBadge>`
wrapper pattern from `colored-badge.tsx` would be over-engineered for
five categorical variants; a local `CategoryBadge` component inside
`tmux-page.client.tsx` is sufficient.

### D10. Inline metadata badges: render only when value is non-null

Per the user's ask, badges whose corresponding table cell currently
shows `—` (em-dash) SHALL be omitted entirely rather than rendered
empty. Concrete predicates per badge:

| badge        | render condition                                    |
|--------------|-----------------------------------------------------|
| `:<port>`    | `row.liveEntry !== null`                            |
| `<agent>`    | `row.parsed.agent !== null` AND `agent !== 'none'`  |
| `<project>`  | `row.parsed.project !== null`                       |
| target link  | `row.matchable && targetHref(row) !== null`         |
| stale indicator | `row.staleReason !== null`                       |

The agent-is-'none' suppression is a small nicety — `agent='none'`
means "bare shell" (`memon-terminal-...`), which is already implied by
the absence of a Claude-specific badge. Rendering an `agent: none` chip
would just be noise.

### D11. Stable client-side ordering across auto-refetch

The previous table page re-sorted rows on every poll because the API
response is `tmuxLastActivity desc` and the client trusted that order
verbatim. With the new card-list ergonomic, rows jumping every five
seconds breaks "find that row I was about to kill". So the client now
maintains an in-memory `orderedNames: string[]` snapshot and rerenders
in that order, updating the per-row content but freezing positions.

**Re-snapshot events** (when the order is reset to the current API order):
- First load (mount, `orderedNames === null`).
- A new sessionName appears in the refetched response — the user just
  created a session manually or another tmux call landed; the new row
  going to the top is the expected behavior.
- The user clicks the `Refresh` button — explicit user intent to see
  the latest order.

**Between events:** rows that disappear (post-kill) drop out, preserving
relative order of the rest. Content fields (live port, last-activity
text, badges) update via React's normal re-render path.

**Not persisted.** The snapshot is component-state, not URL/localStorage.
Reloading the page picks up the API order again — losing the in-memory
ordering between visits is acceptable, since the goal is "stable WHILE
I'm on the page", not "permanent reordering preference".

Implementation note: `data?.sessions` from TanStack Query is structurally
shared, so the snapshot-maintaining effect only triggers a re-render
when names change. Time-ago / port refreshes don't cascade through it.

## Risks / Trade-offs

- **[Risk]** First-paint flash on mobile / tablet boundary: the
  `useMediaQuery` hook returns `false` (mobile) during SSR, then
  client hydration may flip to desktop. The vertical layout renders
  in initial HTML, then snaps to horizontal. → **Mitigation**:
  acceptable for an internal management page that's typically opened
  from desktop. If it bothers anyone, we can refactor to a
  CSS-container-query layout later.

- **[Risk]** A killed selected session leaves a stale `?session=` in
  the URL. → **Mitigation**: the page resolves the query param against
  the current row list each render; if the named session is missing,
  the param is cleared via `router.replace` and the empty state
  renders. No error UI needed.

- **[Risk]** `localStorage` is unavailable in private-mode or some
  iframes. → **Mitigation**: `useLocalStorageState` (whichever helper
  we use) falls back to in-memory state. Sizes just don't persist —
  not a functional regression.

- **[Risk]** `react-resizable-panels` is a new runtime dep (~12KB
  gzipped). → **Mitigation**: it's the canonical shadcn-blessed
  primitive; we use it exclusively here. If it ever ships on other
  pages it amortizes immediately.

- **[Risk]** The right pane's iframe can be tall enough to push the
  page below the fold on short viewports. → **Mitigation**: the
  panel group's parent is `flex-1 min-h-0`, so the iframe stays
  inside the SidebarInset's content region. No outer page scroll —
  the iframe handles its own scrollback.

- **[Risk]** Switching sessions tears down `<TerminalView>` and
  re-mounts it (`key={sessionName}`), which fires `POST
  /api/terminal/start|attach` again. → **Mitigation**: both endpoints
  are idempotent (manager dedups by sessionName); subsequent calls
  return the same `(port, url)` and bump `lastActiveAt`. No new ttyd
  is spawned on re-select. The actual iframe load is cached by the
  browser (same URL).

- **[Trade-off]** We do not preserve the right-pane iframe state when
  switching rows (a different `key` forces unmount). If the user
  bounces between two sessions, each switch is a fresh iframe load.
  A cached approach (hidden iframes for previously-viewed sessions)
  is possible but adds complexity and resource cost — defer until
  someone actually asks.

## Migration

No data migration. No URL backwards compatibility to worry about — old
links to `/manage/tmux` keep working; the only new addition is the
optional `?session=` query param.

Rollout: a single PR after `attach-tmux-by-name` is merged (it's
already implemented per its tasks.md). The change is pure client-side
+ one new dep + one new shadcn component.

## Open Questions

- Should the right-pane header carry per-row actions (Refresh,
  Pop out, Kill) duplicating the per-row buttons in the left pane?
  Current proposal: only `Pop out` (since refresh-the-iframe is a
  niche need and Kill is destructive enough to want from the list).
  Open to revisit.
- Mobile: do we want a "back to list" gesture (e.g. swipe right) when
  the terminal pane fills most of the screen? Skipped for v1 — the
  divider is draggable upward to reveal the list.
