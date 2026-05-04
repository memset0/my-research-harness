## Why

Hypothesis / digest / report IDs are currently written as bare natural
numbers (`H1`, `H3`, `D1`, `R2`). At 1-2 digits, they sort
lexicographically out of order (`H1, H10, H11, H2, H3, …`) in any
plain `ls` / `git diff` / web file tree and look visually inconsistent
across files. For a research project that will accumulate hundreds of
hypotheses + digests over years, **fixed-width 4-digit zero-padding**
(`H0001` … `H9999`) gives:

- Lexicographic sort = numeric sort, so `ls`, file-tree sidebars, and
  raw greps stay in chronological/numeric order.
- Stable column width in tables / TOCs.
- 4 digits is plenty (10k IDs per namespace).

The project hasn't been deployed yet — there is no real-world data on
disk to migrate. So this is a **hard cutover**: every parser is strict
about the new format, every writer emits the new format, and we
rewrite mock + tests + specs + skills in place. No backward-compat
code path, no migration command.

## What Changes

- **BREAKING (data format)** — the canonical and **only accepted**
  on-disk form for every H / D / R ID is 4-digit zero-padded:
  - Hypotheses: `H0001` … `H9999` (was `H1` … `H<n>`)
  - Digests: `D0001-<YYYY-MM-DD>.md` (was `D<N>-<YYYY-MM-DD>.md`)
  - Reports: `R0001-<slug>.md` (was `R<N>-<slug>.md`)
  - Cross-refs in any frontmatter / body / table cell (e.g.
    `hypotheses: [H0001, H0003]`).

- **Parsers reject unpadded forms.** `## H1.` headings,
  `hypotheses: [H1, H3]` arrays, `D5-2026-05-04.md` filenames — all
  produce a structured parse error / surface a warning. There is no
  lenient fallback.

- **Writers emit padded form exclusively.** Every README write, every
  digest creation, every report creation, every system-touched
  HYPOTHESES.md edit goes through the central `padId(prefix, n)`
  helper and never produces unpadded output.

- **No migration CLI command.** The only consumers of the legacy
  format today are: in-repo mock data, in-repo test fixtures,
  in-repo SKILL.md examples, in-repo spec scenarios, the in-flight
  `add-skills-cli` change's inline examples. All get rewritten in
  this same change as plain file edits. After this change ships,
  *no file in the repo* contains an unpadded H/D/R reference.

- **CLI input is strict** — `memon hypo show H3` is a hard error
  (`BAD_REQUEST`); the user types `memon hypo show H0003`. (CLI
  shorthand was considered and dropped — strict everywhere keeps the
  mental model simple.)

- **Anchor IDs and URL fragments use the padded form.** Hypothesis
  cards render `<Card id="H0001">`, cross-refs link to `#H0001`. No
  client-side fallback for legacy `#H1` URLs.

## Capabilities

### New Capabilities

(none — this change is a format tweak across existing capabilities)

### Modified Capabilities

- `hypotheses`: ID format requirement changes from `H<N>` (positive
  integer) to `H<NNNN>` (4-digit zero-padded). Strict everywhere.
- `experiment-readme`: frontmatter `hypotheses` field values use the
  padded form, no exceptions.
- `web-layout`: hypothesis card anchors and cross-resource hash
  fragments are `#H<NNNN>`, not `#H<N>`.
- `memon-cli`: `hypo show <id>` accepts the padded form only;
  unpadded input is `BAD_REQUEST`.

(`web-dashboard`, `agent-handoff`, `journal`, `experiment-discovery`,
`live-updates`, `log-viewer*`, `runtime-cache`, `test-suite`,
`browser-terminal`, `experiment-edit` — scenarios mention IDs but
their requirements don't change semantically; only example text needs
the padded form. Touch via tasks.md, not delta-spec.)

## Impact

- **Code**:
  - `@memon/core`:
    - New `packages/core/src/ids.ts` with `padId`, `parseId`,
      `normalizeId`, `ID_REGEX`, `ID_WIDTH = 4`. Strict regex
      `^[HDR]\d{4}$`.
    - `hypotheses/parse.ts` regex: `^## H(\d{4})\.`. Anything else
      surfaces a parse warning (out-of-format heading), record skipped.
    - `readme/parse.ts` frontmatter `hypotheses` array: each element
      must match `^H\d{4}$`; element-level warning on mismatch, the
      bad element is dropped from the parsed array.
    - `types.ts` doc comments updated.
  - `@memon/cli`:
    - `hypo show` validates input via `parseId` and rejects unpadded
      with `BAD_REQUEST` (exit 2).
  - `apps/web`:
    - Anchor IDs (`<Card id="H0001">`) and any `#H...` link
      generation use the parsed canonical id (always padded).
    - Tests rewriting `H1` literals to padded form.
- **On-disk format**: every fixture rewritten in this change; after
  merge, no remaining unpadded references in the repo.
- **Specs**:
  - Delta specs for `hypotheses`, `experiment-readme`, `web-layout`,
    `memon-cli`.
  - `openspec/changes/add-skills-cli/` (in-flight) gets its inline
    examples rewritten via tasks.md (not a delta — that change isn't
    archived yet).
- **Skills**: every `memon-*/SKILL.md` example reformatted; the
  `digest-journal` filename pattern documented as `D<NNNN>-…`; the
  `write-report` pattern as `R<NNNN>-…`. The next-N derivation in
  each skill formats with `printf '%04d'`.
- **Tests**: every `H<n>` / `D<n>` / `R<n>` literal across `*.test.{ts,tsx}`
  and fixture files updated. Snapshot tests (if any) re-recorded.
- **Mock data**: `mock/project-a/`, `mock/project-b/` rewritten by
  hand (small, ~6 hypotheses + a few cross-refs).
- **Documentation**: `CLAUDE.md` and root `README.md` mention H IDs
  in passing — verify consistency.
- **No external dependencies added.**
