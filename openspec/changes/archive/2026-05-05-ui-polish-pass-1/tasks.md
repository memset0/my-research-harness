## 1. Markdown component: kill backtick pseudo-content

- [x] 1.1 Add `prose-code:before:content-none prose-code:after:content-none` to the wrapper className in `apps/web/components/markdown.tsx`
- [x] 1.2 Verify per CLAUDE.md: curl `/p/<project>/reports/<id>` after dev server is up and grep the served HTML for `<code>` tags containing only the inner text (no `` ` `` characters); curl the compiled CSS bundle and grep for the typography rule that previously emitted `before:content` to confirm it's overridden in the served bundle

## 2. Frontmatter splitter helper

- [x] 2.1 Add `js-yaml` to `apps/web/package.json` (runtime dep) and `@types/js-yaml` (dev dep); run `pnpm install`
- [x] 2.2 Create `apps/web/lib/frontmatter.ts` exporting `splitFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string }`. Match `^---\n([\s\S]*?)\n---\n?` at the start of the file; on match, parse the captured YAML with `js-yaml`'s `load`; on parse failure return `{ frontmatter: null, body: content }` (the original content untouched)
- [x] 2.3 Add a `frontmatter.test.ts` covering: file with frontmatter, file without frontmatter, malformed YAML (returns null + original body), file where `---` appears later but not at the start (no split)

## 3. Inbox pane: render frontmatter as a property panel

- [x] 3.1 In `apps/web/components/inbox-shell.tsx` `SelectedItemPane`, replace `<Markdown>{data.content}</Markdown>` with a `useMemo` that calls `splitFrontmatter(data.content)`; render `<FrontmatterPanel data={frontmatter} />` (only when `frontmatter` is non-null) above `<Markdown>{body}</Markdown>`
- [x] 3.2 Implement `FrontmatterPanel` (co-located in `inbox-shell.tsx` or a new `apps/web/components/frontmatter-panel.tsx`) as a `<dl>`-style 2-column grid: label cell (uppercase, monospace, muted), value cell with type-aware rendering (arrays → `Badge` chips; primitives → monospace span; null/empty → dim em-dash)
- [x] 3.3 Style choices: reuse existing `Badge` and `cn`; do NOT fork shadcn primitives; panel sits above the body with a subtle bottom border separator
- [x] 3.4 Verify per CLAUDE.md: curl a real reports/digests page, grep for the panel's data-attributes / labels and confirm the body that follows no longer contains the leading `---` HR

## 4. Experiment list: status inline + sub-project column

- [x] 4.1 In `apps/web/components/experiment-list.tsx`, restructure the header row (`:82-87`) to columns `id` (col-span-5), `sub-project` (col-span-2), `created` (col-span-2), `updated` (col-span-3); drop the `status` header
- [x] 4.2 Restructure `ExperimentRow` (`:102-161`) so the id cell holds both the id `<span>` and the `<StatusPill>` inline (status pill renders to the right of the id text within the same `col-span-5` cell)
- [x] 4.3 Move the sub-project `<Badge>` out of the id cell into a new `col-span-2` cell. Keep the existing predicate (`subProject !== '' && subProject !== exp.project`); when false, render an empty cell so grid columns stay aligned
- [x] 4.4 Verify per CLAUDE.md: curl `/p/<project>` and grep the served HTML for the new column ordering and confirm `data-slot="badge"` for sub-project sits in its own grid cell, not adjacent to the id span

## 5. Final verification

- [x] 5.1 `pnpm --filter @memon/web typecheck`
- [x] 5.2 `pnpm --filter @memon/web test` (existing tests should pass; new `frontmatter.test.ts` runs)
- [x] 5.3 Sanity-check the served HTML and CSS for both pages per the CLAUDE.md verification protocol (steps 3-4 in particular)
