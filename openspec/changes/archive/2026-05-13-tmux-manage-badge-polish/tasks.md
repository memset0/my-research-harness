## 1. Refactor badge components in `tmux-page.client.tsx`

- [x] 1.1 Remove the standalone `CategoryBadge` component and its `CATEGORY_CLASS` map. Their job is taken over by the new scope/target badge.
- [x] 1.2 Generalize `MetaBadge` to accept the new prop shape:
   ```ts
   type MetaBadgeProps = {
     icon: LucideIcon            // already-rendered icon component (caller passes <Plug />, <Bot />, etc.)
     prefix?: string             // optional Title-Case prefix label (e.g. "Agent", "Run", "Exp", "Project")
     value: React.ReactNode      // the post-prefix content (e.g. ":7683", "claude", "foo-260507")
     className?: string          // color classes applied to the chip (light + dark variants)
     asLink?: boolean
     href?: string
     openInNewTab?: boolean      // when true, anchor gets target="_blank" rel="noopener noreferrer"
   }
   ```
   Internal markup: `<icon className="size-3 shrink-0" /> <span className="font-medium">{prefix}</span> <span className="font-mono">{value}</span>`. The icon spacing is `inline-flex items-center gap-1`. The chip's outer padding stays `px-1.5 py-0.5`.

## 2. Add the four user-listed badge components (and the consistency-trio: project, manual-target, legacy-target, stale-target)

- [x] 2.1 `PortBadge({ port })`: renders `<MetaBadge icon={Plug} value={\`:${port}\`} className="..." />` with the emerald-border + muted-bg color combo. Tailwind classes suggest: `border border-emerald-500 bg-muted text-emerald-700 dark:text-emerald-300`.
- [x] 2.2 `AgentBadge({ agent })`: renders `<MetaBadge icon={Bot} prefix="Agent" value={agent} className="..." />` with the orange family. Suggest: `border-orange-200 bg-orange-100 text-orange-900 dark:border-orange-900/60 dark:bg-orange-900/40 dark:text-orange-200`.
- [x] 2.3 `ProjectBadge({ project })`: renders `<MetaBadge icon={Folder} value={project} />` with the muted family (no prefix, no per-project color). Reuse the existing muted styling.
- [x] 2.4 `ScopeBadge({ row })`: single component that returns one of six variants based on `(row.parsed, row.staleReason, row.matchable)`:
   - matchable + scope=run → MetaBadge with icon `Zap`, prefix `Run`, value `<slug>`, emerald color, asLink to `/p/<project>/r/<slug>`, openInNewTab.
   - matchable + scope=exp → MetaBadge with icon `FlaskConical`, prefix `Exp`, value `<slug>`, sky color, asLink to `/p/<project>/e/<slug>`, openInNewTab.
   - matchable + scope=project → MetaBadge with icon `FolderTree`, prefix `Project`, value `<project>`, violet color, asLink to `/p/<project>`, openInNewTab.
   - manual (matchable=false, staleReason=null, sessionName starts with `memon-manual-`) → MetaBadge with icon `Wrench`, value `Manual` (no prefix; the word `Manual` is the entire content), amber color, no link.
   - legacy (matchable=false, staleReason=null, `parsed.legacy === true`) → MetaBadge with icon `Archive`, value `Legacy`, muted color, no link.
   - stale (staleReason !== null) → MetaBadge with icon `AlertTriangle`, value `Stale (<reason>)`, amber color, no link.
   - other (rare; doesn't match any rule) → fallback to legacy-style.
- [x] 2.5 Color class constants — define them once at module scope so the same Tailwind utilities surface in each variant. Suggest a small map:
   ```ts
   const BADGE_COLORS = {
     port: 'border border-emerald-500 bg-muted text-emerald-700 dark:text-emerald-300',
     agent: 'border border-orange-200 bg-orange-100 text-orange-900 dark:border-orange-900/60 dark:bg-orange-900/40 dark:text-orange-200',
     project: 'bg-muted text-muted-foreground',
     run: 'border border-emerald-200 bg-emerald-100 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/40 dark:text-emerald-200',
     exp: 'border border-sky-200 bg-sky-100 text-sky-900 dark:border-sky-900/60 dark:bg-sky-900/40 dark:text-sky-200',
     projectScope: 'border border-violet-200 bg-violet-100 text-violet-900 dark:border-violet-900/60 dark:bg-violet-900/40 dark:text-violet-200',
     manual: 'border border-amber-200 bg-amber-100 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/40 dark:text-amber-200',
     legacy: 'bg-muted text-muted-foreground',
     stale: 'border border-amber-200 bg-amber-100 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/40 dark:text-amber-200',
   }
   ```

## 3. Rewire `SessionCard` to use the new badge components

- [x] 3.1 In `SessionCard`, remove the lead `<CategoryBadge category={category} muted={stale} />` render (the badge no longer exists).
- [x] 3.2 The header row of the card now contains: title + actions (`Popup` + `Kill`). The badges move to the second row alongside `last activity`.
- [x] 3.3 The badge row replaces the existing chip list with explicit component calls:
   ```tsx
   <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
     <span className="font-mono">{relativeTime(row.tmuxLastActivity)}</span>
     {row.liveEntry && <PortBadge port={row.liveEntry.port} />}
     {p.agent && p.agent !== 'none' && <AgentBadge agent={p.agent} />}
     {p.project && p.scope !== 'project' && <ProjectBadge project={p.project} />}
     <ScopeBadge row={row} />
   </div>
   ```
- [x] 3.4 The new-tab link inside `MetaBadge` adds `target="_blank" rel="noopener noreferrer"` and `onClick={(e) => e.stopPropagation()}` so the click doesn't bubble to the card's row-selection handler.
- [x] 3.5 Imports: add `Plug`, `Bot`, `FlaskConical`, `Zap`, `Folder`, `FolderTree`, `Wrench`, `Archive` to the existing `lucide-react` import (the file already imports several lucide icons; add these to the list).
- [x] 3.6 Remove `categorize()` if it's no longer used by anything (the category type is now an internal detail of `ScopeBadge`).

## 4. Verification

- [x] 4.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 4.2 `pnpm --filter @memon/web test` passes (no new tests; existing 270 stay green).
- [x] 4.3 Rebuild prod via the CLAUDE.md restart sequence (kill listener PID, `pnpm --filter @memon/web build`, then `pnpm start` in background; wait for port).
- [x] 4.4 Per CLAUDE.md F1/F4 verification protocol, read creds from `config.yml` and:
   - `curl … /manage/tmux` → 200.
   - HTML contains the new icon SVG paths (e.g. lucide `Plug` distinctive path data, lucide `Zap` lightning bolt) — verify each of the eight icon types has at least one occurrence per their visible row.
   - HTML contains the prefix label strings: `>Agent<`, `>Run<`, `>Exp<` (in the badge contexts).
   - HTML's `Run`/`Exp`/`Project` target badges have `target="_blank"` AND `rel="noopener noreferrer"` on the anchor.
   - HTML no longer contains the standalone uppercase category chip text (e.g. `>RUN<` capitalized as a standalone badge — only the new Title-Case `>Run<` appears, inside a target-badge link).
   - Compiled CSS contains the new emerald-border / orange-bg / sky-bg / violet-bg / amber-bg utility rules (sanity-check that Tailwind v4 picked them up).
- [x] 4.5 Browser smoke (described, not asserted via curl):
   - The four user-listed badges visibly carry distinct colors and recognizable icons.
   - Clicking a `Run` / `Exp` / `Project` target badge opens a new tab; the `/manage/tmux` tab stays put; the right pane's terminal stays attached.
   - Clicking the card body (not the badge) still selects the row as before.
   - Dark mode (if toggled): colors stay readable; text contrast against the chip's dark `bg-{color}-900/40` backgrounds passes WCAG AA visual check.

## 5. Spec sync check

- [x] 5.1 `openspec validate tmux-manage-badge-polish --type change` exits 0.
- [x] 5.2 No incidental changes to `openspec/specs/tmux-session-management/spec.md` (that file is only synced at archive time).

## 6. Post-implementation feedback fixes (spec+code synced)

- [x] 6.1 **ttyd port glyph**: original ask said "icon + emerald border + muted bg"; refined during apply to "small emerald dot + muted bg + no border + no Plug icon" for compactness. `PortBadge` rebuilt inline (no `MetaBadge` reuse) with `<span class="size-1.5 rounded-full bg-emerald-500" />` as the leading glyph. Spec scenario rewritten; design D1 / D2 / D6 updated; proposal updated. Lucide `Plug` import removed.
- [x] 6.2 **Card visual**: cards now use `bg-card` (white in light mode, dark equivalent in dark mode) instead of the previous transparent background. Selected state uses `border-primary` (full ring) instead of the previous `border-l-2 border-l-primary bg-accent` (one-sided + filled). Spec scenario updated; design D9 added.
