## Context

Today the codebase encodes hypothesis / digest / report identifiers
as `H<N>` / `D<N>` / `R<N>` where `N` is a positive integer with no
padding. This is the format declared in `openspec/specs/hypotheses/spec.md`,
parsed by `packages/core/src/hypotheses/parse.ts`, embedded in
experiment frontmatter (`hypotheses: [H1, H3]`), used as anchor IDs
in the web app (`<Card id="H1">`, `#H1` in URLs), and is the
filename convention for digests (`D<N>-<YYYY-MM-DD>.md`) and reports
(`R<N>-<slug>.md`) that the new skills (`memon-digest-journal`,
`memon-write-report`) write.

The user wants every such ID to be **zero-padded to 4 digits** —
`H0001`, `D0042`, `R0123` — and explicitly **does not want a
backward-compat path**. The project hasn't been deployed; the only
unpadded data on disk is in-repo mock + fixtures + spec / skill
example text, all of which we rewrite in the same change. So we get
a strict format with no migration code.

## Goals / Non-Goals

**Goals:**
- Every NEW H/D/R ID written to disk by any tool / skill / CLI
  command in this repo is 4-digit zero-padded.
- Parsers reject unpadded forms with structured warnings/errors.
- After this change merges, repo-wide grep finds zero unpadded
  H/D/R literals.

**Non-Goals:**
- Backward compatibility with unpadded data on disk.
- A `memon migrate ids` CLI command. (Not needed — no real-world
  data to migrate; in-repo data is rewritten in this same change.)
- CLI shorthand (`memon hypo show H3` resolving to `H0003`). Strict
  everywhere; user types the padded form.
- Renaming experiment run dirs (`<RUN_NAME>-<YYMMDD>-<HHMMSS>`).
  Those are timestamp-keyed; no padding needed.
- Auto-running anything on `memon serve` startup.

## Decisions

### D1. Padding width = 4

**Choice**: 4 digits. `H0001`–`H9999`.

**Why not 3 or 5?**
- 3 (`H001`–`H999`) caps at 999, conceivable for a long-running
  project to hit.
- 5 (`H00001`–`H99999`) is overkill — research projects rarely
  exceed a few hundred hypotheses, and 5-wide eats real estate in
  tables.

4 is the right round number for "fixed-width" + "won't run out".
User explicitly chose 4 ("默认都是四位数, 因为我们是科研项目").

### D2. Strict everywhere — no lenient parser

**Choice**: Every parser (`packages/core/src/hypotheses/parse.ts`,
`readme/parse.ts`, the web client's display code, the CLI's input
validators) accepts ONLY `H<NNNN>` / `D<NNNN>` / `R<NNNN>` (literally
4 ASCII digits). Anything else produces a structured parse warning
(in document parsing) or a `BAD_REQUEST` error (in CLI input).

**Alternative considered**: Lenient-on-read, strict-on-write. Rejected
because the user explicitly said no compat layer is wanted, and the
project hasn't shipped — there's no real data to be lenient toward.

Side benefit: future code audits / lint rules can use the strict
regex (`^[HDR]\d{4}$`) without carrying a `\d{1,4}` fallback that
forever obscures whether unpadded ids are actually possible.

### D3. Single `padId` / `parseId` helper module

**Choice**: New file `packages/core/src/ids.ts` exporting:

```ts
export const ID_WIDTH = 4
export const ID_PREFIXES = ['H', 'D', 'R'] as const
export type IdPrefix = (typeof ID_PREFIXES)[number]

/** Format an integer as the canonical padded ID, e.g. padId('H', 3) → 'H0003' */
export function padId(prefix: IdPrefix, n: number): string

/**
 * Parse a strict canonical ID. Returns {prefix, n} for valid input;
 * returns null for anything else (including legacy unpadded forms).
 */
export function parseId(s: string): { prefix: IdPrefix; n: number } | null

/** Strict regex that matches the canonical form only. */
export const ID_REGEX: RegExp // /^([HDR])(\d{4})$/
```

`normalizeId(s)` — present in the original lenient design — is
**dropped**. There's nothing to normalize when the only accepted
form is canonical.

**Why centralize**: regex was inline in `hypotheses/parse.ts` as
`/^H(\d+)\.\s+/` and the ID strings live in many test fixtures.
Centralizing means one place to change if the schema ever moves
again, and a single grep-able import-site list.

### D4. Out-of-range and out-of-format inputs are warnings, not crashes

**Choice**: When a parser encounters an unpadded form (`H1`),
overlong form (`H10000`), or otherwise-malformed id, it surfaces a
structured warning (`{ code: 'INVALID_HYPOTHESIS_ID', value: 'H1', ... }`)
on the parse result and skips the entry. The overall parse keeps going.

**Alternative considered**: Hard fail the whole document on first
malformed id. Rejected because tests intentionally mix valid and
invalid examples (and at least one fixture exists to test the
warning path itself).

The doctor sweep (`memon doctor`) will pick up these warnings via
its existing `PARSE_WARNING` channel, so an in-progress migration
gets surfaced to the user rather than disappearing.

### D5. Filename patterns for digests and reports

**Choice**:
- Digest: `D<NNNN>-<YYYY-MM-DD>.md` (e.g. `D0001-2026-05-04.md`).
- Report: `R<NNNN>-<slug>.md` (e.g. `R0007-bf16-investigation.md`).

The next-N derivation snippet in each skill changes from a plain
`echo $N` to `printf 'D%04d-...' "$N"` so the resulting filename
matches the new pattern. Globs (`docs/digests/D*-*.md`) still work
unchanged; the skill body is updated to call out the format.

### D6. Web app — direct render, no redirect shim

**Choice**: Hypothesis cards render `<Card id="H0001">`. Links to
hypotheses use `#H0001`. There is no client-side `useEffect` that
catches legacy `#H1` fragments and redirects.

The original lenient-design proposed (D7 in the prior draft) such a
shim to preserve old bookmarks. With no deployment yet, no
bookmarks exist. Code stays clean.

## Risks / Trade-offs

- **Risk**: A writer somewhere in the codebase emits an ID
  string-formatted from an integer with `String(n)` instead of going
  through `padId()`. → **Mitigation**: lint rule (or grep-based
  pre-commit) flagging `\b[HDR]\${...}\b` template literals; code
  review checklist; centralizing all writers via `padId()`.

- **Risk**: A test or fixture I miss in the rewrite still has a
  legacy id, and the now-strict parser rejects it. → **Mitigation**:
  task §7 is a repo-wide grep specifically to catch stragglers; CI
  fails until clean.

- **Trade-off**: Strict CLI input means muscle-memory `memon hypo
  show H3` returns an error rather than auto-padding. Acceptable —
  the user explicitly wanted no compat layer, and the error message
  is informative.

- **Risk**: The `add-skills-cli` change is in-flight; touching its
  inline example text in this change creates a small merge surface
  if someone is editing it concurrently. → **Mitigation**: do the
  rewrite in one mechanical pass, get it reviewed alongside this
  change.
