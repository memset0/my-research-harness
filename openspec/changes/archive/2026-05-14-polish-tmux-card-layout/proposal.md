## Why

The `/manage/tmux` session cards now carry three logical pieces of
information — title + actions, metadata badges, and pane info (running
program + window title). After the recent pane-info addition the card
became visually busy: time was tucked at the start of the badge row,
buttons carried redundant text labels, and the badge inventory still
included a `Manual` chip plus two visually distinct "project" badges
(muted `Folder` on run/exp rows vs violet `FolderTree` on
project-scope rows) that mean the same thing.

The user wants the card to read in two cleanly separated zones:

- **Content** (top) — the addressable identity: title, time, actions,
  and any classifying badges.
- **Footer** (bottom) — what's currently running inside (the pane
  info added in the previous change).

…and a small badge-rule cleanup so identical concepts render
identically.

## What Changes

### Card layout split

- Each `SessionCard` SHALL render two visually distinct regions:
  **content** (top) and **footer** (bottom).
- **Content row 1** SHALL contain, left to right: the stripped title
  (existing logic), then a right-aligned cluster of relative-time +
  `Popup` icon button + `Kill` icon button. Time is no longer the
  first item of the badge row; it sits next to the actions on row 1.
- **Content row 2** SHALL render the badge inventory (port, agent,
  project, scope/target) only if AT LEAST ONE badge would otherwise
  appear. When no badge applies, row 2 is not present in the DOM.
- **Footer** SHALL render the existing pane-info line (icon +
  command + `·` + title) visually separated from the content above by
  a thin top border. When `row.pane` resolves to nothing renderable,
  the footer (including its separator) SHALL NOT be in the DOM.
- Footer text color SHALL be a near-foreground tone (not the
  `muted-foreground` tint used today). The current `text-[10px]`
  muted-foreground reads poorly against the card background; the
  footer carries the most informative bit of the card and should be
  legible.

### Claude-specific footer rendering

- When `pane.currentCommand === 'claude'`, the footer's leading
  command segment SHALL render as a Claude-brand glyph + the word
  `Claude` (capitalized), in Claude's brand-orange color family —
  instead of the generic `Activity` lucide icon + lowercase command
  text. The glyph SHALL be the `✻` character (the same glyph Claude
  Code uses in its own PTY title), wrapped in a `<span>` styled with
  `text-orange-500` (light) / `text-orange-400` (dark).
- For all other foreground commands the footer keeps the existing
  generic rendering: `Activity` icon + the command in its current
  monospace style.
- The `·` separator and the title-tail segment are unchanged in both
  cases.

### Card footer status indicator (four-state)

The footer SHALL also reflect the session's **liveness state** via a
background color tint. Four states:

| State | Color | When |
|---|---|---|
| `idle` | default (no tint) | nothing matched; fresh session |
| `running` | blue tint | current `pane.title` matches the running rule |
| `attention` | amber tint | current `pane.title` matches the attention rule |
| `done` | emerald tint | was previously detected as `running`, current title no longer matches `running` AND `attention`, user has not yet opened a ttyd for this session since |

The state SHALL be computed on the **server side** (in
`apps/web/lib/terminal/`) and exposed on `TmuxSessionRow` as
`state: 'idle' | 'running' | 'attention' | 'done'`. The client maps
the state to a footer background class; no client-side state machine.

**Precedence each tick** (single direction, no ambiguity):

1. `attention` if the rule matches → `attention`. Reactive — exits
   the moment the rule no longer matches; does NOT need
   user-acknowledgement to clear.
2. Else `running` if the rule matches → `running`. Reactive.
3. Else `done` if the per-session memo flag
   `hadUnacknowledgedRunning` is `true` → `done`.
4. Else → `idle`.

**Memo lifecycle**:

- `hadUnacknowledgedRunning` is set to `true` the moment the row's
  current eval is `running`.
- It is cleared to `false` when the manager registers a ttyd entry
  for this `sessionName` (whether via `startSession` or
  `attachExistingSession`, whether fresh or idempotent reattach).
- It survives across pane-cache ticks and across the rule no longer
  matching `running`; it does NOT decay automatically.
- It is pruned on enrichment passes where the sessionName has
  disappeared from the host (`tmux ls` no longer surfaces it).

**Detection rules**:

- `running`: the FIRST character of `pane.title` is either (a) in
  the Unicode **Braille Patterns** block (`U+2800`–`U+28FF`, 256
  code points total — covers every Braille spinner character used
  by Claude Code, codex, and similar TUIs) OR (b) a member of a
  small explicit extras set `RUNNING_PREFIX_CHARS` for future
  non-Braille additions (initially empty). Both the range list
  `RUNNING_PREFIX_RANGES = [[0x2800, 0x28FF]]` and the extras set
  are named exports of a single module so adding new prefixes is a
  one-line constant change.
- `attention`: `pane.title` contains the substring `action required`
  case-insensitively. (More patterns may be added later.)
- Both rules SHALL be implemented as small, named pure functions
  with their constants as named exports for easy future extension.

**Visual rendering**:

- The footer's text content (Claude glyph vs `Activity` icon, command
  text, `·` separator, title-tail) SHALL be IDENTICAL across all four
  states. State only changes the footer's background tint.
- The card's hover `title=` HTML attribute (browser tooltip on hover)
  SHALL show the raw untruncated `pane.title`, unchanged across
  states. This is the same behaviour the previous change shipped; no
  state suffix is appended.
- The page's `document.title` / `<title>` element (the browser tab
  label) is OUT OF SCOPE for this change. The existing per-route
  title from the `page-titles` capability is preserved verbatim.
- Background tint utility classes:
  - `idle` → none (footer reads on the card's `bg-card` color)
  - `running` → `bg-blue-50 dark:bg-blue-950/40`
  - `attention` → `bg-amber-50 dark:bg-amber-950/40`
  - `done` → `bg-emerald-50 dark:bg-emerald-950/40`

### Buttons become icon-only

- The `Popup` and `Kill` buttons in the card action cluster SHALL
  render with only their lucide icon (`ExternalLink` and `Trash2`
  respectively); the visible text labels `"Popup"` and `"Kill"` are
  removed. The `aria-label` (already present) continues to provide
  the accessible name.

### Badge rule cleanup

- **Manual badge removed**: rows whose sessionName starts with
  `memon-manual-` SHALL NOT render any scope/target badge. (Currently
  they render a `Wrench` icon + `Manual` text in amber.) Combined
  with manual rows usually having no live ttyd / no parsed agent /
  no parsed project, a typical manual row's content row 2 collapses
  to absent — only the title + time + buttons remain in the content
  zone.
- **Legacy / Stale / Other** scope-badge variants STAY. The
  "fall-through Other" badge still renders for unparseable
  non-manual names.
- **Project badge unified**: on every row whose parsed `project` is
  non-null AND the row is not currently rendering a project-scope
  ScopeBadge (i.e. `scope` is `'run'` or `'exp'`), the project badge
  SHALL adopt the same visual treatment as the project-scope
  ScopeBadge variant: `FolderTree` icon, violet color family,
  prefix `Project`, value = project name, rendered as a `<Link>` to
  `/p/<project>` with `target="_blank"` `rel="noopener noreferrer"`.
  The previous muted `Folder` + naked project-name treatment is
  removed.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `tmux-session-management`: card structure changes (content/footer
  split, time placement, icon-only buttons), and the badge inventory
  rules update (manual variant removed; project badge unified across
  run/exp/project scopes).

## Impact

- **Code touched**: `apps/web/app/manage/tmux/tmux-page.client.tsx`
  only. No backend / API / config / type changes.
- **No new deps**.
- **Visual behavior**: a manual row with no ttyd / no pane info now
  collapses to a single-line card (title + time + 2 icons). Active
  Claude rows show the most useful signal — `✻ Claude — …` — in the
  visually distinct footer.
- **No accessibility regression**: aria-labels remain on the
  icon-only buttons; tooltips already render via Tailwind's
  default `title=` attribute support for hover.
