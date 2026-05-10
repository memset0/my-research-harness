## 1. Core types and parser (`packages/core`)

- [x] 1.1 Add `plan: string | null` field to `ExperimentSections`
      interface in `packages/core/src/types.ts` (after `method`, before
      `conclusion`, matching the canonical body section order).
- [x] 1.2 Add `'Plan'` to the `STANDARD_EXPERIMENT_SECTIONS` tuple in
      `packages/core/src/experiments/parse.ts` (between `'Method'`
      and `'Conclusion'`).
- [x] 1.3 In `parseExperimentReadme`, populate `sections.plan` via
      `getSection('Plan')` (same pattern as the other body sections).
- [x] 1.4 Confirm absence of `## Plan` produces no parser warning
      (the existing "unknown section" warning loop only fires for
      headings NOT in `STANDARD_EXPERIMENT_SECTIONS`, so once `Plan`
      is in the tuple, missing `Plan` is silently tolerated like the
      other body sections).

## 2. Serializer (`packages/core`)

- [x] 2.1 Extend `SECTION_ORDER` in
      `packages/core/src/experiments/serialize.ts` to
      `['motivation', 'method', 'plan', 'conclusion', 'caveats']`.
- [x] 2.2 Add `plan: 'Plan'` to the `HEADING_FOR` map in the same
      file.
- [x] 2.3 Verify the existing "emit empty H2 if section is null"
      branch covers the new `plan` key without any other change
      (it should — the loop is generic over `SECTION_ORDER`).

## 3. Round-trip tests (`packages/core`)

- [x] 3.1 Add a unit test that parses an exp doc whose `## Plan`
      body contains nested GFM task lists (mix of `- [ ]`, `- [x]`,
      and 2- and 4-space-indented children, plus a free-form
      reflection paragraph), then re-serializes it, and asserts the
      `## Plan` body round-trips byte-for-byte modulo trailing
      whitespace normalization.
- [x] 3.2 Add a unit test for a legacy exp doc with no `## Plan`
      heading: assert `sections.plan === null`, no parse warning is
      emitted for the absence, and the serialized output contains
      an empty `## Plan` placeholder in the canonical position
      (immediately after the Method block, before `## Conclusion`).
- [x] 3.3 Add a unit test that round-trips a non-Plan edit (modify
      `sections.method`, leave `sections.plan` untouched) and
      asserts the emitted `## Plan` body equals the input body
      byte-for-byte.

## 4. Web rendering (`apps/web`)

- [x] 4.1 In `apps/web/components/experiment-page.tsx`, add a
      `<SectionCard heading="Plan" body={exp.sections.plan} />`
      between the existing `Method` and `Conclusion` SectionCard
      lines.
- [x] 4.2 Verify `apps/web/components/markdown.tsx` already enables
      `remark-gfm` (it does as of the snapshot at file head) so GFM
      task list rendering needs no plugin additions.
- [x] 4.3 Confirm `react-markdown` + `remark-gfm` produces
      `<input type="checkbox" disabled>` for `- [ ]` and
      `<input type="checkbox" checked disabled>` for `- [x]` at every
      nesting depth supported by GFM. Defensive override added: a
      `components.input` mapping forces every checkbox-typed input
      to carry `disabled` + `readOnly` regardless of upstream defaults.
- [x] 4.4 Add a small set of `prose` overrides in `markdown.tsx` so
      task list items have correctly aligned hanging indents at 2+
      nesting levels and the disabled checkbox shows obvious
      affordance (cursor + opacity). Done inline in the existing
      `cn(...)` block — no new component file.

## 5. Web rendering tests (`apps/web`)

- [x] 5.1 Add a unit test for the `Markdown` component (via
      Testing Library) that renders a 2-level nested GFM task list
      and asserts: 3 `<input type="checkbox">` are present; the
      checked-state matches the `[x]` markers; every checkbox has
      the `disabled` attribute; clicking a checkbox does not change
      its `checked` value.
      → `apps/web/test/browser/markdown-task-list.test.tsx` (4 tests).
- [x] 5.2 Add a snapshot or DOM assertion for the
      `experiment-page.tsx` SectionCard ordering: Plan Card appears
      between Method and Conclusion in the rendered tree.
      → `apps/web/test/browser/experiment-page-plan.test.tsx` (3
      tests: position, body→checkbox flow, empty placeholder).

## 6. End-to-end verification (per CLAUDE.md F1)

- [x] 6.1 Build + start prod (per CLAUDE.md "prefer prod build")
      with the kill-old-process-before-rm-rf-`.next` sequence:
      `pnpm --filter @memon/core build && pnpm --filter @memon/web build`,
      then start on port 3737. Done — server PID logged at
      `/tmp/memon-prod.log`, port 3737 LISTEN confirmed.
- [x] 6.2 Read auth credentials from `config.yml` (per CLAUDE.md
      "HTTP API auth"). Done.
- [x] 6.3 Fixture: added `## Plan` to
      `mock/project-a/docs/experiments/E0001-vpred-convergence.md`
      with 6 top-level tasks, mixed `[x]` / `[ ]`, nested
      sub-tasks (γ sweep) and reflection sub-bullets.
      Verification path note: this surface is a TanStack Query
      client-rendered page, so the SSR HTML emitted by Next does
      NOT contain the section bodies (only the React shell). The
      F1-equivalent verification is a chain instead of a single
      curl-grep:
      (a) `GET /api/experiments?project=project-a` returns items
          whose `sections` keys are
          `['motivation','method','plan','conclusion','caveats']`
          in canonical order — **verified**.
      (b) `GET /api/experiments/E0001-vpred-convergence?project=project-a`
          returns 200 with `sections.plan` carrying the nested
          checkbox markdown verbatim — **verified**.
      (c) The DOM-level rendering claim (disabled checkboxes,
          nested `<ul>` inside `<li>`, `[x]` → `checked`) is
          covered by the JSDOM + RTL tests in 5.1 / 5.2, which
          render through the same `Markdown` component the prod
          page uses. **Verified by `pnpm vitest`**.
- [x] 6.4 Verify the compiled CSS (`/_next/static/css/...css`)
      still contains the semantic tokens already required by
      CLAUDE.md F2. Verified — `--background`, `--foreground`,
      `--card`, `--muted`, `--primary` all present in the layout
      CSS bundle.

## 7. Typecheck and test gate

- [x] 7.1 `pnpm --filter @memon/core typecheck` is clean.
- [x] 7.2 `pnpm --filter @memon/web typecheck` is clean.
- [x] 7.3 `pnpm --filter @memon/core test` is green — 211/211
      passing, including the new
      `src/experiments/parse-serialize.test.ts` (5 tests).
- [x] 7.4 `pnpm --filter @memon/web test` is green — 266/266
      passing, including the new
      `test/browser/markdown-task-list.test.tsx` (4 tests) and
      `test/browser/experiment-page-plan.test.tsx` (3 tests).
