## Why

The cards on `/manage/tmux` carry their metadata as five neutral chips
in a row (`:7683 · claude · project-a · foo-260507 · ⚠ stale …`).
Even with the category badge as a colored lead, the chip row reads as
visually flat — eyes can't pick out "this is the ttyd port" or "this
is the run target" without reading every chip. The user asked for a
polish pass: give each badge an icon, prefix the agent/scope chips
with a label word, and add color so the row scans at a glance.

## What Changes

### Each metadata chip gets an icon, color, and (for three of them) a prefix label

The current `MetaBadge` (plain `bg-muted` chip) is replaced with badges
that carry an icon and category-specific color treatment. Per the user
ask, the four explicitly-listed badges are:

- **ttyd port** — a small **emerald dot** glyph followed by `:<port>` on
  the same muted background as the neutral chips. No iconfont (a dot is
  more compact than a `Plug` icon) and no border. No prefix label.
- **Agent** — `[Bot] Agent <agent>` (e.g. `Agent claude`). Colored.
- **Exp** target — `[FlaskConical] Exp <slug>` for matchable rows where
  `scope === 'exp'`. Sky color. Stays a clickable link to
  `/p/<project>/e/<slug>` and **opens in a new tab** (`target="_blank"`).
- **Run** target — `[Zap] Run <slug>` for matchable rows where
  `scope === 'run'`. Emerald color. Stays a clickable link to
  `/p/<project>/r/<slug>` and **opens in a new tab** (`target="_blank"`).

### Adjacent badges follow the same pattern for consistency

To avoid a stylistic split between "the four the user listed" and
"the others on the same card", the remaining badges are polished the
same way (icon + appropriate color, with prefix labels where it reads
naturally):

- **Project** (parsed `<project>` for scope = `run` / `exp`) —
  `[Folder] <project-name>`. Neutral color (matches the current
  muted muted-foreground treatment). NO prefix label — `<project-name>`
  on its own is unambiguous and adding "Project" would create visual
  noise next to the colored `Run/Exp <slug>` badge that comes after.
- **Project-scope target** (when the row is `scope === 'project'`,
  which has no per-target slug) — `[FolderTree] Project <project>` in
  violet. Clickable, links to `/p/<project>` and **opens in a new
  tab** (`target="_blank"`). Replaces what would otherwise be the
  separate project + target pair.
- **Manual** — `[Wrench] Manual` in amber. NOT clickable (manual rows
  have no addressable target).
- **Legacy** — `[Archive] Legacy` in muted. NOT clickable.
- **Stale** — `[AlertTriangle] Stale (<reason>)` in
  amber/destructive. NOT clickable. (Same triangle icon as today,
  same amber.)

### The standalone uppercase category chip is folded into the new target badge

Today every card carries TWO scope signals: the leading category chip
(`RUN` uppercase, colored) AND a separate target link chip
(`foo-260507` muted). The new design collapses these into one chip
that does both jobs: prefix label tells you the category, the rest
tells you the target. So `[Zap] Run foo-260507` (one chip) replaces
`[RUN][foo-260507]` (two chips). For manual / legacy / stale rows
(which have no target slug), the chip is just the prefix label.

### Capabilities

#### New Capabilities
<!-- none -->

#### Modified Capabilities
- `tmux-session-management`: the inline-badge structure inside the
  per-row card is replaced — each badge now has an icon, the
  agent / exp / run badges carry a prefix label, the ttyd port badge
  carries a green border, and the standalone uppercase category chip
  is folded into the new target/scope-combined badge.

## Impact

- `apps/web/app/manage/tmux/tmux-page.client.tsx` — the only file with
  visible UI changes. The `CategoryBadge` and inline `MetaBadge`
  components get replaced with a single `ScopeBadge` (or set of
  per-type badge components) covering all five visual variants.
- No backend, API, or routing change. No new dependencies (all icons
  are existing `lucide-react`).
- No tests touched directly (the page has no existing test file).
  Verification is curl + browser smoke per the CLAUDE.md
  verification protocol.
- Spec delta on `openspec/specs/tmux-session-management/spec.md`
  describing the new per-badge rules.

## Alternative considered (NOT proposed)

Keep the standalone category chip AND polish the inline badges. This
preserves visual continuity with what shipped yesterday in
`tmux-manage-split-pane`, but reading two scope indicators per card
(`RUN` chip + `[Zap] Run foo-260507` target chip) is more visual noise
than information. If the user prefers this, they can flag during
implementation and we'll keep the lead category chip as-is and only
polish the inline rows.
