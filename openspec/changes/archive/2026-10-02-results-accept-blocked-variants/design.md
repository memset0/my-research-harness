## Context

See proposal.md (Why). Results parsing lives in `@memon/core`
(`experiments/documents.ts`): `js-yaml` loads `results.yaml` with the JSON
schema, a Zod schema validates it, and `normalizeResultVariant` builds the
`ResultVariant` model. Any Zod issue makes the whole document `data: null`, so
the CLI, the Backend Results snapshot (`400`) and the Experiment detail (no
Results projection) all lose every Variant because of one row. The Backend
protocol (`backend-protocol.ts`) re-validates the sanitized document with its
own status enum and a string-only `env` record.

Central serves Project data through the in-process Backend handler. Its
`projectRead` operation writes every response with `writeJson`, whose default
bound is `MAX_BACKEND_CONTROL_JSON_BYTES` (1 MiB). A read-only reproduction on
a scratch copy of the operator bundle, with the two schema issues patched in
the copy, measured the release Backend's responses: Results snapshot
1,187,141 bytes and Experiment detail 2,251,560 bytes (the detail carries the
sanitized Results data, the rendered Results Markdown and ~380 lint
diagnostics). Both exceed 1 MiB, so fixing parsing alone would turn the detail
from `200` into `500 PAYLOAD_TOO_LARGE`.

Client components must not import `@memon/core` at runtime; the Results table's
pure logic (`apps/web/lib/experiment-results/`) only uses type imports.

## Goals / Non-Goals

**Goals:**

- One canonical Variant status list in core, shared by the Results schema and
  the Backend protocol, with a type-checked mirror in the Web.
- A single malformed-but-meaningful env value no longer hides a Results
  document, and the author learns that the value was coerced.
- Large Experiment documents are served by central without lifting the bound
  of any other route.

**Non-Goals:**

- No lint rule for `BLOCKED` (no required description, no forbidden `runs`).
- No preservation of a number's source spelling in `env`.
- No change to Status row filters (they keep comparing text).
- No change to the other lint findings an operator document may carry
  (undeclared columns, type mismatches, unassigned Runs): they are content
  issues that never block reading.
- No skill text change: the bundled skills still list six Variant statuses;
  documenting `BLOCKED` there is a separate skills release.
- No streaming or slimming of the Experiment detail payload.

## Decisions

### D1. `BLOCKED` joins the canonical status list after `PLANNED`

`types.ts` gains `VARIANT_STATUS_VALUES = ['PLANNED', 'BLOCKED', 'RUNNING',
'COMPLETED', 'FAILED', 'INCONCLUSIVE', 'DROPPED'] as const`, and
`VariantStatus` is derived from it. The Results Zod schema and
`BackendResultsDocumentSchema` both use `z.enum(VARIANT_STATUS_VALUES)`, so the
parser and the protocol cannot drift again. The order is the lifecycle order:
not started (`PLANNED`, `BLOCKED`), in flight (`RUNNING`), finished with an
outcome (`COMPLETED`, `FAILED`, `INCONCLUSIVE`), abandoned (`DROPPED`).
`BLOCKED` sits next to `PLANNED` because it is a planned Variant waiting on a
prerequisite. `types.ts` stays import-free, so the protocol module gains no
heavy dependency.

Alternatives: mapping `BLOCKED` to `PLANNED` on read (loses the author's
signal and breaks round-trips); an `extra` passthrough status (every consumer
would need an "unknown status" branch).

### D2. `BLOCKED` adds no validation rule

`validateVariant` has no status-dependent rule today, and a blocked Variant can
legitimately carry earlier `attempts[]`. Requiring a description or forbidding
`runs` would make existing documents fail lint for the very state this change
admits. The spec states the meaning; enforcement stays social.

### D3. env numbers and booleans are coerced with a warning

The Results schema accepts `string | number | boolean` per env value (a
union whose error map keeps the familiar `Expected string, received <type>`
message for `null`, lists and mappings); the normalizer converts non-strings
with `String(value)` (shortest round-trip spelling; `true` → `"true"`) and
records a
`RESULTS_ENV_VALUE_COERCED: … read as "…"` parse warning with the Zod-style
field path (`variants.<index>.provenance.env.<NAME>`). `parseYamlDocument`
gains a warnings sink that normalizers append to, and `parsedDocument` returns
them as `parseWarnings`. Warnings already flow to `validateExperimentManagedDocuments`
(as warning diagnostics), `memon experiment doc lint` (exit 0 on warnings),
the detail's `documentDiagnostics` and the Results snapshot's `warnings`;
severity `warning` never sets `documentReadOnly`. The model type stays
`Record<string, string>`, so `serializeResultsYaml` writes strings, which
`js-yaml` quotes when they look numeric. The raw-preserving annotation upsert
keeps whatever the author wrote.

Alternatives: keep rejecting (status quo; one value hides 400 Variants);
silent coercion (hides the spelling change); preserve the source text through
a custom YAML type (js-yaml's JSON schema exposes no source text, and a custom
schema would diverge from every other memon YAML read); widening the model to
scalars (leaks into the protocol, the Web and every writer, against "writes
stay strings").

### D4. Experiment detail and Results snapshot get a 16 MiB response bound

`http/paths.ts` adds `MAX_BACKEND_EXPERIMENT_DOCUMENT_JSON_BYTES = 16 MiB`.
`projectRead` takes an optional `maxBytes` and forwards it to `writeJson`; only
the Experiment detail and Results snapshot routes pass the document bound.
16 MiB leaves about seven times the measured detail size. Over the bound the
existing bounded `500 PAYLOAD_TOO_LARGE` body is still returned. The JSON
string is built before the size check today, so peak memory per request does
not change; the bound only decides whether the bytes are sent.

Alternatives: raising the global control bound (also lifts the Run list's
deliberate page bound and every other read); dropping Results data or its
Markdown projection from the detail (breaks the "Central detail preserves the
safe v6 document contract" requirement and the Web data flow); streaming JSON
(no streaming encoder exists for control reads).

### D5. A shadcn `Badge` wrapper renders Variant statuses

New `components/variant-status-badge.tsx` exports `VariantStatusBadge`, which
composes `Badge variant="outline"` with a per-status class map through `cn`
(and forwards `className`), and sets `data-status`. `StatusCell` delegates to
it. `BLOCKED` uses the orange palette plus `border-dashed`: red is `FAILED`
and amber is `INCONCLUSIVE` in this table, and the dashed outline also reads
as "not started" without relying on colour. The existing statuses keep their
classes. Editing `ui/badge.tsx` is ruled out (shadcn primitives are never
forked); reusing the managed-section red `BLOCKED` style would collide with
`FAILED`.

### D6. The Status column sorts through an optional sort key

`ResultTableColumn` gains an optional `getSortValue`; `sortVariants` uses it
when present and `getValue` otherwise. The Status column returns the lifecycle
rank from `lib/experiment-results/status.ts`, whose
`Record<VariantStatus, number>` fails type-checking if a status is ever missing
(the Web cannot import core's runtime list). Filters, display and SOTA keep
using `getValue`. Saved Views store only column IDs and directions, so they
keep working and simply sort by lifecycle. Alternatives: returning the rank
from `getValue` (breaks display and filters); special-casing statuses inside
the generic comparator.

### D7. The CLI needs tests, not code

`results table --status` upper-cases and set-matches the given values, and
`results summary` prints the status verbatim, so `BLOCKED` and coerced env
values work once core parses them. CLI tests pin both.

## Risks / Trade-offs

- [CLIs from 8.1.0 and earlier still reject `BLOCKED`] → the release is a
  MINOR (`central,cli`); nodes pick it up with `memon update`. Documents that
  already use `BLOCKED` are unreadable on old CLIs today, so nothing regresses.
- [A multi-megabyte detail reaches the browser] → measured 2.25 MB for the
  largest known document; acceptable for a detail page, and bounded at 16 MiB.
- [Coercion changes a number's spelling] → the warning names the field and the
  normalized value and tells the author to quote it.
- [Status sorting changes from alphabetical to lifecycle order for every
  status] → the previous order was unspecified and meaningless; the new order
  is specified and stable.

## Migration Plan

No data migration and no version bump of the FS convention or the Results
schema. Ship as release `8.2.0` (`central,cli`): build a new release directory,
preview it on loopback with a copied mock project containing a `BLOCKED`
Variant, cut central over, then switch the CLI launcher. Rollback: restore the
runner and launcher backups that select the 8.1.0 release directory and
restart; documents remain untouched by this change, so rollback only brings
back the old rejection.
