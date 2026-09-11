## 1. Descriptor and source editing

- [x] 1.1 Add `apps/web/lib/wiki-components/checklist@1/index.ts` with the strict recursive zod schema (title, optional content/children, optional status booleans), alias-rejecting YAML parse, manual text (fields, independent states, human-authorization boundary), example, invalid examples, fixtures, and `toMarkdown`; register it in `registry.ts`; verify with `checklist@1/index.test.ts` covering minimal recursive items, all-false defaults, string `"false"` rejection, aliases, and unknown fields
- [x] 1.2 Add `apps/web/lib/wiki-components/checklist@1/update.ts`: pure `setChecklistStatus(document, { line, payload, path, field, value })` that locates the fenced block by source line, checks payload identity, edits one boolean through the YAML document API preserving comments and surrounding bytes; verify tests for duplicate blocks, nested paths, frontmatter offset, CRLF, and payload mismatch rejection

## 2. Rendering and Wiki interaction

- [x] 2.1 Add `apps/web/components/wiki-components/checklist@1.tsx` (bold dotted numbering, three labelled shadcn Checkbox controls, Collapsible content only when non-empty, read-only disabled state with description when no write context) and wire it in `index.tsx`; carry fence `line`/`payload` from the Markdown `pre` renderer into `WikiComponentBlockView`; verify markdown-wiring test renders numbering, collapsed content, and disabled controls
- [x] 2.2 Add a `WikiChecklistWriteProvider` used by `WikiDocumentView` (full page and side pane) that calls `putWikiPage` with the displayed snapshot's `mtime`/`hash`, updates `['wiki-page', ...]` and `['wiki', project]` on success, disables controls while pending, and surfaces 409/read-only/403 errors with a reload action via toast; verify with a component test using a mocked `putWikiPage` that a toggle sends the updated document and that a 409 leaves the checkbox unchanged
- [x] 2.3 Add neutral fixture page(s) under `mock/project-a/docs/wiki/` referenced by the descriptor fixtures; verify `registry.test.ts` fixture coverage passes

## 3. Verification and examples

- [x] 3.1 Run `pnpm --filter @memon/web typecheck` and the focused tests from 1.x/2.x; build an isolated production preview of the working tree and verify `GET /api/wiki/components/checklist@1` lists the state fields and authority boundary (production host untouched: its project is `read_only`, and the working tree carries unrelated uncommitted work — see the release note in design.md)
- [x] 3.2 Replace the prototype examples in the user's `W0001` home page with a real `checklist@1` block (recursive items, empty content/children, no human flags asserted), commit it with `memon wiki commit`; verify in a headless browser on desktop and mobile widths that numbering, collapse, and an owner toggle persist across reload
