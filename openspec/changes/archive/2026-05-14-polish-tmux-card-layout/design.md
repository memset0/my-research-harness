## Context

`/manage/tmux` renders one `SessionCard` per `memon-*` tmux session
on the host. After the previous `expose-tmux-pane-info` change, the
card layout looks like:

```
┌──────────────────────────────────────────┐
│ claude-...--run--foo-...     [↗ Popup] [✕ Kill] │  row 1
│ 5m · :7683 · Agent claude · project-a · Run foo │  row 2 (time + badges)
│ ⏱ claude · ✻ Claude — Building digest…           │  row 3 (pane info, muted)
└──────────────────────────────────────────┘
```

Three visual issues surfaced in real-world use:

1. **No clear zoning**: pane info (the most useful "what's happening"
   signal) reads as dim aux text, easy to miss.
2. **Badge inventory**: a `Manual` chip on every manual row is
   redundant — those rows already show `manual-` stripped in the
   title and have no other badges; the chip is noise. The muted
   `Folder` "project" chip on run/exp rows duplicates info that the
   project-scope `ScopeBadge` variant encodes with a richer
   treatment.
3. **Action buttons** carry redundant `Popup` / `Kill` text labels
   that crowd the title row.

On top of layout polish, the user wants the card footer to **also**
encode the session's liveness state: a four-color tint that signals
whether work is happening, blocking, recently done, or idle.

This change unifies all of that into one card refactor.

## Goals / Non-Goals

**Goals:**

- Two-zone card: **content** (title + time + actions + optional
  badges) above; **footer** (pane info + state tint) below, with a
  visible separator.
- Right-aligned time on the title row; icon-only Popup / Kill.
- Badge inventory: drop the Manual variant, unify Project visuals
  across run/exp rows with the project-scope ScopeBadge style.
- Claude-specific footer rendering — orange `✻ Claude` instead of
  the generic `Activity` icon + lowercase command.
- Footer text becomes legible (near-foreground, not muted-foreground).
- Four-state liveness indicator surfaced as a footer background tint:
  `idle | running | attention | done`. State is computed server-side
  with persistent memo for the `done` transition.

**Non-Goals:**

- No change to `TmuxSessionRow.pane` shape — the existing fields are
  enough.
- No change to the right-pane header echo (it stays muted today; if
  needed it can pick up the same Claude/state treatments in a later
  pass).
- No change to the page's `document.title` / browser tab label — the
  existing per-route title from the `page-titles` capability is
  preserved.
- No change to `/api/tmux-sessions` route, auth, or polling cadence.
- No client-side state machine. The server returns
  `state: 'idle' | 'running' | 'attention' | 'done'` and the client
  picks a Tailwind background class.

## Decisions

### D1. Two zones, single root `<div>`

Keep the existing `SessionCard` root `<div>` (so click handlers,
keyboard handling, selected `border-primary`, hover, focus ring all
still apply card-wide). Split internal layout:

```
<div className="card-root">           // existing root, p-2.5
  <div className="content">           // mt-0, no border
    <div className="row1">…</div>     // title + time + buttons
    {hasAnyBadge && <div className="row2">…</div>}  // optional
  </div>
  {footerVisible && (
    <div className="footer">          // mt-2, border-t, pt-1.5, bg-<state-tint>
      …
    </div>
  )}
</div>
```

The content / footer split happens entirely inside the card's
existing padding box — the footer's `border-t border-border/40` plus
`-mx-2.5 px-2.5` (negative margin to extend the divider to the card
edges) gives a clean visual separator without breaking the rounded
corners. The state tint sits inside the footer's padded area.

### D2. Content row 1: title fills, time + buttons right-aligned

```tsx
<div className="flex items-center gap-2">
  <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={row.sessionName}>
    {strippedTitle}
  </span>
  {row.tmuxLastActivity && (
    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
      {relativeTime(row.tmuxLastActivity)}
    </span>
  )}
  {popup && <Button size="sm" variant="ghost" aria-label="Open in popup" ...>
    <ExternalLink className="size-3" />
  </Button>}
  <Button size="sm" variant="ghost" aria-label="Kill session" ...>
    <Trash2 className="size-3" />
  </Button>
</div>
```

`align-items: center` on row 1 (was `items-start`) so the time +
buttons sit baseline-aligned with the title. Time renders only when
`row.tmuxLastActivity` is non-empty (existing rule).

The mobile-hide rule on Popup (`hidden md:inline-flex`) is preserved
because the spec already requires it.

### D3. Content row 2: badges only, conditional render

`row2` carries port, agent, project, scope/target — the same badges
as today but **time is removed** (moved to row 1). The badge row is
absent from the DOM when no badge would render.

Compute `hasAnyBadge` in the component:

```ts
const scopeBadgeWillRender = computeScopeBadgeRenders(row)  // see D4
const hasAnyBadge =
  row.liveEntry !== null ||
  (p.agent !== null && p.agent !== 'none') ||
  (p.project !== null && p.scope !== 'project') ||
  scopeBadgeWillRender
```

For manual rows (sessionName starts with `memon-manual-`) with no
liveEntry / no parsed agent / no parsed project, every clause above
is false → row 2 is omitted entirely. The card collapses to row 1 +
(optional footer).

### D4. ScopeBadge: drop Manual variant; keep Legacy / Other / Stale

Current cascade (paraphrased):

```ts
function ScopeBadge({ row }) {
  if (row.staleReason !== null) return <Stale … />
  if (matchable run)             return <Run … />
  if (matchable exp)             return <Exp … />
  if (matchable project)         return <Project … />   // FolderTree, violet
  if (sessionName.startsWith('memon-manual-')) return <Manual … />   // ← REMOVED
  if (parsed.legacy)             return <Legacy … />
  return <Other … />
}
```

After the change, the `memon-manual-` branch returns `null` (the
ScopeBadge component returns null entirely — `null` is preferred
over an empty `<span>` because the parent's `hasAnyBadge` calc reads
function output as "is this badge rendered or not").

Helper `computeScopeBadgeRenders(row)` returns `true` IFF the
ScopeBadge would render a non-null element. It's the same cascade
logic but as a boolean, used by `hasAnyBadge` in D3. Keep the two
implementations in sync via a single shared classifier that returns
the variant tag (or `null` for manual) so both `ScopeBadge` and
`computeScopeBadgeRenders` derive from it.

The Stale variant continues to short-circuit and is unaffected.

### D5. Project badge unified with project-scope ScopeBadge visual

Today's `ProjectBadge` (Folder icon, muted) is replaced inline at
its call site with the same `<MetaBadge>` shape used by ScopeBadge's
project variant:

```tsx
<MetaBadge
  icon={FolderTree}
  prefix="Project"
  value={p.project}
  className={BADGE_COLORS.projectScope}
  asLink
  href={`/p/${encodeURIComponent(p.project)}`}
  openInNewTab
/>
```

Render condition stays: `p.project !== null && p.scope !== 'project'`
(project-scope rows still only render the ScopeBadge to avoid
duplicate project visuals).

The `ProjectBadge` function itself is removed (or repurposed as a
thin wrapper if reuse helps — but the call site is single, so an
inline `<MetaBadge>` is fine).

### D6. Footer: separator, near-foreground text, Claude special case

```tsx
{footerVisible && (
  <div
    className={cn(
      'mt-2 -mx-2.5 border-t border-border/40 px-2.5 pt-1.5',
      'flex items-center gap-1 text-[10px] font-mono text-foreground/85',
    )}
  >
    {hasPaneContent && (
      <>
        {/* command segment */}
        {pane.currentCommand === 'claude' ? (
          <span className="font-semibold text-orange-600 dark:text-orange-400 shrink-0">
            <span aria-hidden>✻</span> Claude
          </span>
        ) : (
          <>
            <Activity className="size-3 shrink-0 text-foreground/60" aria-hidden />
            {!isUninformativeShell(pane.currentCommand) && (
              <span className="shrink-0">{pane.currentCommand}</span>
            )}
          </>
        )}
        {showSeparator && <span className="opacity-60">·</span>}
        {pane.title && <span className="min-w-0 truncate">{pane.title}</span>}
      </>
    )}
    <StateBadge state={row.state} />
  </div>
)}
```

`footerVisible` is true when EITHER `hasPaneContent` is true (existing
`displayPane(...)` logic — command and/or title renderable) OR
`row.state !== 'idle'`. The second condition catches the rare
case where state should display (e.g. `done`) but the row has no
pane content right now — the badge still gets a slot.

`text-foreground/85` is the legibility upgrade — was
`text-muted-foreground/90` previously. No state-based background
tint is applied to the footer container — state is encoded by the
small `StateBadge` pill in the right-aligned corner (D12).

The negative margin `-mx-2.5` matches the card's `p-2.5` so the
footer extends to the card's left and right edges. The
`border-t border-border/40` is the visible content/footer divider.

### D7. Claude glyph + color choice

- **Glyph**: `✻` (U+273B). This is the literal character Claude
  Code uses in its own PTY title (seen live in the previous
  change's verification — `✻ Claude — Building digest…`,
  `✳ on-policy-old`, etc.). Reusing the same glyph creates the
  recognition pattern: "I've seen this in my terminal, that's
  Claude."
- **Color**: `text-orange-600` (light) / `text-orange-400` (dark).
  `orange-600` in light mode is `oklch(64.6% .222 41.116)` — a
  deeper, warmer orange that visually matches Anthropic's
  "Sandstone" brand color more accurately than the brighter
  `orange-500` we started with. The dark-mode `orange-400`
  (`oklch(75.1% .197 51.7)`) stays bright enough to read against
  the dark card surface. `font-semibold` (bumped up from
  `font-medium`) gives the segment more visual heft so the
  Claude pill reads as the most prominent element of the footer.

Alternative considered: bundle a custom Claude SVG. Rejected —
adds an asset for a single 10px glyph; native font rendering of
`✻` is universally supported and stylable.

### D8. Four-state liveness — semantics

State precedence each evaluation tick (in order; first match wins):

1. **`attention`** — `pane.title` matches the attention rule.
   Reactive: exits the moment the rule stops matching; no
   user-acknowledgement required to clear.
2. **`running`** — `pane.title` matches the running rule. Reactive.
3. **`done`** — the persistent flag
   `hadUnacknowledgedRunning[sessionName]` is `true`.
4. **`idle`** — fall-through default.

The flag's lifecycle:

- **Set to `true`** every tick where eval was `running` (step 2
  matched). Idempotent.
- **Cleared to `false`** when the terminal manager registers a ttyd
  entry for this `sessionName`. Specifically, at the end of
  `manager.startSession()` and `manager.attachExistingSession()`
  AFTER the new `Entry` is committed to `state.sessions`. Both fresh
  spawn and idempotent reattach paths clear the flag — the user's
  action signal is "I opened the ttyd from the dashboard", and that
  signal is present in both code paths.
- **Pruned** when `tmux ls` no longer lists the sessionName — the
  memo entry is removed so killed-and-gone sessions don't leak
  memory. Pruning happens at the end of every enrichment pass.
- **Survives**: pane-cache tick boundaries, the rule no longer
  matching `running`, attention transitions, page reloads (server
  state, not client). Resets on Node process restart (acceptable —
  same lifecycle as the manager's `state.sessions` map).

Warning ↔ running ↔ done all observe the precedence above; the
common transitions:

```
idle      ─[running rule]→  running ─[no run/att]→     done  ─[user opens]→ idle
idle      ─[attn  rule]─→  attention ─[no rule]→        idle
running   ─[attn  rule]─→  attention ─[no rule]→        done  (flag was set during running)
attention ─[running rule]→ running   ─[no run/att]→     done
```

`done` is the ONLY sticky state. Everything else is a direct
function of current `pane.title`.

### D9. Detection rules — strict prefix code-point range + substring match

- **Running**: the FIRST code point of `pane.title` falls in the
  Unicode Braille Patterns block (`U+2800`..`U+28FF`, 256 code
  points) OR is a member of an explicit extras set. Both data sources
  are named exports in `apps/web/lib/terminal/pane-state.ts`:
  ```ts
  /** Code-point ranges that signal "active work" by the foreground program. */
  export const RUNNING_PREFIX_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x2800, 0x28FF], // Braille Patterns (covers every spinner glyph Claude / codex use)
  ]

  /** Single-character additions outside the ranges. Empty by default. */
  export const RUNNING_PREFIX_CHARS: ReadonlySet<string> = new Set<string>()
  ```
  The two specific characters the user originally singled out (`⠐`
  U+2810, `⠂` U+2802) both live inside the Braille Patterns block,
  so the range supersedes the original 2-char enumeration.
  `matchesRunning(title)` SHALL extract the first **code point** via
  `title.codePointAt(0)` (NOT `title[0]` — to handle surrogate pairs
  correctly when future ranges land outside the BMP) and check
  membership in any of the ranges OR in the extras set. The check is
  the FIRST code point only.

- **Attention**: `pane.title.toLowerCase().includes('action required')`.
  A named export:
  ```ts
  export const ATTENTION_PATTERNS: readonly string[] = ['action required']
  ```
  Matched as a substring case-insensitively. (More substrings can be
  added later by appending.)

- Both detection functions live in `pane-state.ts` as small pure
  functions: `matchesRunning(title)` and `matchesAttention(title)`.

The rule predicates SHALL only consider `pane.title`. They SHALL
NOT consider `pane.currentCommand` or `pane.currentPath` — the user
explicitly tied detection to the title.

### D10. Storage module placement — new `pane-state.ts`

A new module `apps/web/lib/terminal/pane-state.ts` owns:

- `RUNNING_PREFIX_CHARS`, `ATTENTION_PATTERNS` constants.
- `matchesRunning(title: string | null): boolean`,
  `matchesAttention(title: string | null): boolean`.
- `PaneSessionState = 'idle' | 'running' | 'attention' | 'done'` type.
- `computePaneState(sessionName: string, pane: TmuxPaneInfo | null): PaneSessionState`
  — reads + updates the memo, returns the state.
- `clearPaneStateMemo(sessionName: string): void` — called by manager
  on ttyd registration.
- `prunePaneStateMemoToActiveSet(activeSessionNames: Set<string>): void`
  — called at the end of each enrichment pass.
- `__resetPaneStateMemoForTests(): void` — test helper.

The memo is pinned on `globalThis.__memonPaneStateMemo` to survive
Next.js HMR, mirroring the existing `__memonTerminalState` /
`__memonTmuxPaneCache` patterns.

This module is placed alongside `tmux-discover.ts` (which calls
`computePaneState`) and `manager.ts` (which calls
`clearPaneStateMemo`). Importing both ways from `pane-state.ts` keeps
no circular deps — `pane-state.ts` itself imports only types and
`globalThis` patterns; tmux-discover.ts imports the compute + prune
functions; manager.ts imports clearPaneStateMemo.

### D11. TmuxSessionRow.state — wire shape

The row shape gains:

```ts
export interface TmuxSessionRow {
  …
  pane: TmuxPaneInfo | null
  /** Liveness state derived from pane.title + memo. */
  state: 'idle' | 'running' | 'attention' | 'done'
}
```

Server-side, `listMemonTmuxSessions` calls
`computePaneState(row.sessionName, row.pane)` after attaching
`row.pane` and writes the result to `row.state`. The enrichment
function then calls `prunePaneStateMemoToActiveSet` with the set of
sessionNames just observed.

The single-row endpoint `GET /api/tmux-sessions/:name`
(`getEnrichedSession`) goes through the same path and returns the
same field.

Client API type in `apps/web/lib/api.ts` is updated to include
`state` on `TmuxSessionRow`.

### D12. State → corner badge (client-side)

```ts
const STATE_BADGE_CONFIG: Record<
  Exclude<TmuxSessionRow['state'], 'idle'>,
  { label: string; chip: string; dot: string }
> = {
  running: {
    label: 'RUNNING',
    chip: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200',
    dot: 'bg-blue-500',
  },
  attention: {
    label: 'ATTENTION',
    chip: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
    dot: 'bg-amber-500',
  },
  done: {
    label: 'DONE',
    chip: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
}
```

The badge wrapper carries `font-sans font-semibold tracking-wide` so
the all-caps label renders as a status pill — overriding the parent
footer's `font-mono`. The relative-time label on row 1 also uses the
sans-serif default (no `font-mono`); monospace is reserved for code-y
strings (session names, command basenames, pane titles).

`StateBadge` returns `null` for the `idle` state — idle is encoded
by ABSENCE so idle cards stay visually quiet. For the other three
states, the badge is a small pill (`size-1.5` colored dot + label
text) right-aligned in the card footer via `ml-auto`. Position:
bottom-right corner of the card.

The card body, content zone, badges, and title row are untouched
by state. The card's existing `border-primary` selection treatment
continues to apply regardless. No background tint is applied to the
footer container itself — earlier iterations tried `bg-blue-50` /
`bg-amber-50` / `bg-emerald-50` washes on the footer, but a small
corner pill reads more clearly without competing with the card's
white surface or with the existing badge colors above.

### D13. Manager hook for "user opened ttyd" → clear memo

In `apps/web/lib/terminal/manager.ts`:

- `doStartSession`: AFTER `state.sessions.set(sessionName, entry)`,
  call `clearPaneStateMemo(sessionName)`.
- `doAttachSession`: same — AFTER the `entry` is committed.
- The idempotent return path (when an existing healthy entry is
  reused at the top of `doStartSession` / `doAttachSession`) ALSO
  calls `clearPaneStateMemo(sessionName)`. The user's intent of
  "I clicked open" is independent of whether ttyd is freshly spawned
  or reattached.
- `stopSession` does NOT clear the memo — stopping a ttyd is an
  automatic cleanup (idle TTL / LRU eviction / manual stop). It
  doesn't represent "user acknowledged the prior running".

### D14. lastStateChangeAt — refresh the displayed clock on every transition

The card's "last activity" label is the user's main read of "how fresh is
this card?". Tmux's `session_activity` already covers input/output —
typing, program output, ttyd attach redraw — but does NOT capture
"Claude just went idle" or "an Action-Required prompt just appeared".
With only `tmuxLastActivity`, a row that's been running quietly for an
hour and just transitioned to `done` would still read "1h ago", burying
the most useful "this just changed" signal.

**Decision**: track a second timestamp server-side — `lastStateChangeAt`
— and let the client take `max(lastStateChangeAt, tmuxLastActivity)`.

**Memo schema** (extends D10):

```ts
interface MemoEntry {
  hadUnacknowledgedRunning: boolean
  lastState: PaneSessionState              // ← new: for transition detection
  lastStateChangeAt: string | null         // ← new: ISO8601 of last transition
}
```

**Update rule** (each tick, inside `computePaneState`):

1. Compute `newState` per the existing precedence (D8).
2. Look up the memo entry for `sessionName`.
3. If no entry exists, create it with `{ lastState: newState,
   lastStateChangeAt: null, hadUnacknowledgedRunning: ... }`. First
   observation is NOT a transition — we don't stamp a time so the card
   falls back to `tmuxLastActivity` until something actually changes.
4. If an entry exists and `entry.lastState !== newState`, set
   `entry.lastStateChangeAt = new Date().toISOString()` and update
   `entry.lastState = newState`.
5. If an entry exists and `entry.lastState === newState`, leave
   `lastStateChangeAt` untouched.

**Reset events**: `clearPaneStateMemo` (called from
manager.startSession / attachExistingSession) deletes the entire memo
entry — `lastStateChangeAt` drops to `null` on the next tick along
with `hadUnacknowledgedRunning`. `stopSession` does NOT clear (per
D8/D13 — same lifecycle as the running flag).

**Wire shape**: `TmuxSessionRow` gains
`lastStateChangeAt: string | null`. The single-row endpoint goes
through the same path. Client API type updated to match.

**Client display**: a small helper `pickDisplayActivity(row)` returns
the more-recent of the two timestamps (ISO string), or `null` when
neither is parseable. The relative-time label uses that string;
`null` means the label is omitted entirely.

This makes state transitions the "loud" signal — they refresh the
clock instantly — while tmux input/output still bumps the time when
nothing about state changed (e.g. a user typing inside a long-idle
shell).

**Alternative considered**: overwrite `tmuxLastActivity` server-side
on every transition. Rejected — destroys the original signal and
prevents callers from reading either timestamp independently (a
future per-session detail panel might want to show both).

## Risks / Trade-offs

- **[Running detection over-eager — Claude's idle UI also uses Braille]**
  → Mitigated by strict prefix match: only `⠐` and `⠂` count today.
  If we observe Claude's idle title also leads with those two
  characters, the rule can be tightened (e.g., require a following
  space + action verb). The strict-set design makes this a
  one-character change.
- **[Color conflict between orange Claude glyph and state tints]**
  → The state tints are all `*-50` (light) / `*-950/40` (dark) —
  very pale washes. Orange-500 sits comfortably on every wash; the
  amber attention tint is the closest in hue but the glyph's
  saturation makes it read as distinct.
- **[Manual rows with no badges and no pane info collapse to one
  line]** → Intentional. A title + time + 2 icon buttons is a clean
  affordance; manual rows are by definition "I made this; don't
  bother labeling".
- **[Memo memory leak if pruning misses a sessionName]** → Pruning
  uses the set of sessionNames observed in the current enrichment
  pass; a sessionName missing from the host's `tmux ls` AND missing
  from the manager-held entries gets pruned. The only way to leak
  is if a sessionName is in the memo but tmux exposes it on every
  poll — that's a normal alive session, not a leak.
- **[State machine race: ttyd registration vs pane fetch in the same
  tick]** → manager.startSession resolves before its
  `clearPaneStateMemo` call; subsequent pane enrichment passes will
  read the cleared flag. There IS a brief window where a UI client
  could fetch `/api/tmux-sessions` BETWEEN clearPaneStateMemo and
  the next enrichment — in which case the state is still computed
  from the (cleared) memo + current pane.title at that moment. That
  produces the correct answer (idle/running/attention depending on
  title). No regression.
- **[Page tab title pollution]** → Explicitly out of scope. The
  page-titles capability still controls `document.title`; this
  change does NOT append state markers there.

## Open Questions

- Should the right-pane header (the slim bar above the iframe that
  echoes pane info) also pick up Claude/state treatments? The user
  asked only about cards. Deferring to a follow-up.
- Should the running prefix set live in config instead of code, given
  the user said "more characters might be added later"? Going with
  code-const for now to keep this change tight; can promote to
  config in a follow-up if the iteration cadence demands it.
- Should agent-specific glyphs extend to codex / opencode (e.g. a
  cyan codex)? Possible, but not asked for now. Defer.
