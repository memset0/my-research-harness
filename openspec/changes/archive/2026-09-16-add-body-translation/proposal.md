## Why

English-authored experiment, wiki, and report documents are harder for Chinese-speaking readers to follow. Readers need on-demand Chinese translations alongside the original body without changing authoritative research documents or paying through a separately configured API-key provider.

## What Changes

- Return all validated body cache hits with the initial manifest using bounded bulk SQLite reads. Submit remaining packs concurrently and apply each response independently; only cache misses enter the existing bounded two-invocation Codex queue.

- Follow-up: cap translation-owned Codex calls, including readiness, at two per serving process; use English control copy and a single Alt+T/button toggle that retains loaded translations for the unchanged body.

- Add owner-triggered English-to-Simplified-Chinese bilingual body translation for experiment documents, wiki pages, and Markdown reports. Original text remains the default and is never overwritten.
- Extract prose only from explicitly registered reading-body regions, retaining inline formatting and protecting code, mathematics, identifiers, links, and non-prose widgets. Include prose rendered from experiment structured sections, not raw YAML or README pointer lines.
- Adapt kiss-translator's block/inline classification, protected placeholders, and bounded batching approach to React-owned document rendering, with strict response alignment, cancellation, and content-version invalidation.
- Run a server-side Codex wrapper inspired by paperland using the serving instance's existing local ChatGPT authentication and the exact model `gpt-5.3-codex-spark`. Do not silently fall back to another model or API-key billing.
- Add bounded translation scheduling, per-document content-keyed cache, explicit progress/retry states, and owner-only authenticated endpoints. Browser clients and remote project nodes never receive Codex credentials.
- Record upstream revisions and source-reuse constraints before implementation; direct copying is conditional on resolved licensing, not assumed from public source availability.

## Capabilities

The authorized activation follow-up adds an uncanonicalized PATH command or symlink for Codex, a native `auth.json` path, an Alt+T reading toggle, and verified deployment activation without including unrelated pending changes.

### New Capabilities

- `body-translation`: Body extraction, bilingual presentation, safe batching, lifecycle, authorization, and bounded local SQLite caching across the three document types.
- `codex-translation-provider`: Local authenticated Spark invocation, protocol validation, isolation, bounded execution, and actionable failures.

### Modified Capabilities

None. Existing source formats, editing, review, scope authorization, and canonical projection contracts are preserved; the new specifications define the opt-in reading layer.

## Impact

Web reading components, shared Markdown rendering, structured experiment prose renderers, Web server configuration/runtime and auth route classification, plus focused unit and browser tests. No filesystem convention change, document translation writes, CLI document commands, remote-node Codex installation, or new external database.

Initial scope excludes run panels, navigation/frontmatter/diagnostics/generated outlines, code and math, raw component payloads, and HTML report/wiki iframe interiors. Visible prose captions outside those interiors remain eligible. Local auth means the machine/process serving memon, not an arbitrary browser client's computer. These scope choices are explicit review points in the design.
