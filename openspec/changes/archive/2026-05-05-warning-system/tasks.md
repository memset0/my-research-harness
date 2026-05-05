## 1. Core types & parser (`packages/core`)

- [x] 1.1 Add `Warning` type: `{ rowId: string; status: 'OPEN' | 'RESOLVED'; created: string; category: WarningCategory; message: string; resolved: string | null; note: string | null; }` plus the `WarningCategory` union and a runtime `WARNING_CATEGORIES` set
- [x] 1.2 Extend `Experiment` (or `experiment.sections`) with `warnings: Warning[]`, `warningsRaw: string | null`, and add `WARNING_*` parse warning codes (`UNKNOWN_WARNING_CATEGORY`, `WARNINGS_SECTION_NOT_TABLE`, `WARNING_STATUS_LOWERCASE`)
- [x] 1.3 Implement `parseWarningsSection(body: string): { warnings: Warning[]; raw: string | null; parseWarnings: ParseWarning[] }` — anchored heading match, table parser, pipe/`<br>` unescape, rowId comment extraction, status normalisation
- [x] 1.4 Implement `serializeWarningRow(w: Warning): string` (writer-side counterpart) — pipe escape, newline → `<br>`, rowId comment trailing
- [x] 1.5 Implement `findWarningsSectionRange(lines: string[]): {start, end} | null` (anchored `^## Warnings\s*$` match, end = next H2 line or EOF)
- [x] 1.6 Implement `insertWarningsSection(lines, canonical position)` — between Caveats and Artifacts; fallbacks per design D4
- [x] 1.7 Implement section-bound writer `applyWarningOp(content: string, op: WarningOp): { content: string; rowId?: string }` covering `add | resolve | reopen | delete`
- [x] 1.8 Implement pre-flush diff assertion: any line outside the captured Warnings range MUST be byte-identical pre/post; assertion failure throws an internal error
- [x] 1.9 Generate `rowId` of the form `w_<isoCreatedColonsToHyphens>_<4hex>` with a 16-bit random suffix; reject duplicates at insert time
- [x] 1.10 Add unit tests covering: empty section, populated section, unknown category preserved, lowercase status normalised, non-table content (`WARNINGS_SECTION_NOT_TABLE`), pipe-escape round-trip, `<br>` round-trip, missing-section insertion at canonical position (with both anchors / one anchor / neither anchor present), diff-assertion catching out-of-range mutation
- [x] 1.11 Add fixture READMEs under `packages/core/test/fixtures/warnings/` covering the matrix above

## 2. CLI (`packages/cli`)

- [x] 2.1 Add `commands/experiment/warning.ts` with `add | list | resolve | reopen | delete` subcommands wired under `memon experiment warning`
- [x] 2.2 `add`: validate `--category` against the closed enum (exit 2 BAD_REQUEST on miss), generate ISO timestamp + rowId, call section-bound writer, append `[WARNING]` JOURNAL event, return `{ok, rowId, mtime, hash}`
- [x] 2.3 `list`: read-only, support `--status open|resolved|all` (default `all`), JSON array output following existing `--format` convention
- [x] 2.4 `resolve`: require `--note` (exit 2 BAD_REQUEST without it), set `Resolved=<now-ISO>`, set `Note`, append `[WARNING]` event with `op=resolve`
- [x] 2.5 `reopen`: clear `Resolved` + `Note`, preserve `Created`, append event
- [x] 2.6 `delete`: remove row, append event whose body contains the deleted row's full content for reversibility
- [x] 2.7 All write subcommands honour `--expected-mtime` + `--expected-hash`; on stale lock exit 9 with stderr JSON containing current `mtime + content + hash`
- [x] 2.8 Wire NOT_FOUND (exit 4) for unknown `<rowId>` on `resolve|reopen|delete`
- [x] 2.9 Add `WARN_UNRESOLVED` (severity `info`) to `memon doctor`'s rule set; emit `count` field
- [x] 2.10 Update CLI integration tests under `packages/cli/test/`: golden-output tests for each subcommand, conflict path, BAD_REQUEST path, NOT_FOUND path
- [x] 2.11 Update `memon-cli` README / help text to reflect the new commands

## 3. HTTP API (`apps/web`)

- [x] 3.1 Add `app/api/experiments/[id]/warnings/route.ts` — `GET` + `POST`
- [x] 3.2 Add `app/api/experiments/[id]/warnings/[rowId]/route.ts` — `PATCH` + `DELETE`
- [x] 3.3 All handlers `assertWithinProjectRoots()` on the resolved experiment id before any FS access
- [x] 3.4 Wire each handler through the shared section-bound writer; map CONFLICT → 409 with `{warnings, mtime, hash}` body
- [x] 3.5 Append `[WARNING]` JOURNAL event from the API path (or via the same shared helper used by the CLI)
- [x] 3.6 Add API integration tests covering: GET, POST happy path, PATCH resolve / reopen, DELETE, 404 on missing rowId, 409 on stale mtime, path-safety rejection
- [x] 3.7 Verify against the `pnpm --filter @memon/web typecheck` + the project's existing API smoke tests

## 4. Web dashboard UI (`apps/web`)

- [x] 4.1 Create `components/warnings-card.tsx` rendering the table with status / category badges, per-row controls
- [x] 4.2 Slot the card into the experiment detail page between `Caveats` and `Artifacts`
- [x] 4.3 Use the existing `colored-badge.tsx` wrapper pattern for OPEN/RESOLVED + per-category badges; **DO NOT fork shadcn primitives** (CLAUDE.md F3)
- [x] 4.4 Build the Resolve flow: inline note input + submit → `PATCH` with `op=resolve`
- [x] 4.5 Build the Reopen flow: optional note → `PATCH` with `op=reopen`
- [x] 4.6 Build the Note inline-edit on RESOLVED rows; submit via `PATCH op=resolve` (idempotent)
- [x] 4.7 Build the Delete flow with shadcn `<AlertDialog>` confirm; on confirm → `DELETE`
- [x] 4.8 Build the Add-warning form: shadcn `<Select>` for category (8 enum values), `<Textarea>` for message, `<Button>` for submit; require non-empty message
- [x] 4.9 Plumb conflict-aware save: each write carries current `mtime + hash`; on 409 reuse the existing conflict-resolution dialog (or a parallel one with identical UX) and preserve pending edits as drafts
- [x] 4.10 Implement localStorage draft autosave: `memon:warning-note-draft:<path>:<rowId>:<mtime>` and `memon:warning-add-draft:<path>:<mtime>`, debounced ~500ms
- [x] 4.11 Extend the 7-day stale-draft sweep to cover the new key families
- [x] 4.12 Header count badge: "<n> open / <m> resolved" using the existing badge pattern
- [x] 4.13 Empty state: "No warnings — add one if you noticed something the human should review" + Add affordance
- [x] 4.14 Verify: shadcn `llms.txt` re-anchor before any new component install (CLAUDE.md F4); run the Verification Protocol §1–5 against `/p/<project>/<id>` for an experiment with and without warnings; confirm tokens for any new badge variant exist in `globals.css`

## 5. Skills (`packages/skills`)

- [x] 5.1 Create `packages/skills/memon-append-warning/SKILL.md` — model-invocable, English body, single-call workflow `memon experiment warning add`, one-retry-on-CONFLICT, anti-pattern block forbidding `resolve|reopen|delete`
- [x] 5.2 Update `packages/skills/memon-run-experiment/SKILL.md` with §7 "post-run anomaly review" step: anchored after the README write step, calls `memon experiment warning add` with `--project-root .`, includes the "what qualifies" paragraph and the explicit Anti-pattern list, and includes the forbidden-ops anti-pattern
- [x] 5.3 Update `packages/skills/memon-digest-journal/SKILL.md` doctor sweep: define the (a)+(b) scope explicitly, walk per-experiment, surface proposals to the user before any `add` call, integrate `WARN_UNRESOLVED` items into the same review pass, anti-pattern block
- [x] 5.4 Update `packages/skills/README.md` (skill index) to list `memon-append-warning` alongside the other 6 skills, marking its risk tier
- [x] 5.5 Static-check pass: grep every `packages/skills/memon-*/SKILL.md` for `warning resolve|warning reopen|warning delete` — all matches must be inside an explicit Anti-pattern block; add this as a CI / test-suite check
- [x] 5.6 Update the skill bundling so `memon install-skills` picks up the new skill into `.claude/skills/`, `.codex/skills/`, `.opencode/skills/` (verify with `memon install-skills --dry-run`)

## 6. Wiring & cross-cutting

- [x] 6.1 Update `packages/core` index to export the new `Warning` type, category enum, and parser/writer helpers used by both CLI and web
- [x] 6.2 Confirm client components do NOT pull `@memon/core` JS at runtime (CLAUDE.md web conventions) — use `import type` for `Warning` in client files; runtime category list inlined where needed
- [x] 6.3 Add a JOURNAL event-tag entry `[WARNING]` to wherever the canonical event-tag list lives (parser docs / journal capability)
- [x] 6.4 Migration story: when `warningsRaw` is non-null and `warnings: []`, the CLI's write subcommands SHALL exit with a clear diagnostic asking the user to either format the section as a table or rename it (no auto-rewrite)

## 7. Verification

- [x] 7.1 `pnpm --filter @memon/core test` — unit tests pass (parser, writer, section-bound diff assertion)
- [x] 7.2 `pnpm --filter @memon/cli test` — CLI integration tests pass
- [x] 7.3 `pnpm --filter @memon/web typecheck` clean
- [x] 7.4 `pnpm --filter @memon/web test` — API + UI tests pass
- [x] 7.5 Manual UI verification per CLAUDE.md Verification Protocol §1–5 on a real experiment with warnings: HTML markup grep, compiled CSS token grep, empty-state, populated state, conflict path, mobile viewport
- [x] 7.6 `openspec validate warning-system --type change` clean
- [x] 7.7 Static-check 5.5 passes across all bundled skills

## 8. Docs

- [x] 8.1 Update top-level `README.md` (or its skills section) to mention the warnings surface
- [x] 8.2 If a section in CLAUDE.md needs to know about warnings (e.g. "F-series" lessons learned), draft a one-liner pointer; do not over-write the file
