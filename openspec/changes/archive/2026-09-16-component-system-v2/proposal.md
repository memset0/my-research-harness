## Why

Every component today has its own way of receiving data (attributes in the info string, hand-rolled YAML parsing, a bespoke `script/captured_*` provenance for `memon-data`), there are four hardcoded "registered" lists that drift, descriptor and renderer types are not linked, only `checklist` can write anything back, and an agent must call `memon wiki components show` over HTTP to learn a component's fields. The owner wants one model: a component is a type plus a version that receives one object, and that object comes either from the code block itself or from executing a Python function whose result is cached beside the document.

## What Changes

- **BREAKING**: new declaration syntax `` ```<lang> <type>@<N> #<id> `` — the first token is the payload language (`yaml`/`json` parse to an object; any other language yields `{ data: "<verbatim>" }`), the second is the component type and major version, the optional third is a block id. Info-string attributes are removed; every option lives in the payload.
- **BREAKING**: components are renamed and restarted at `@1`: `datatable` (was `memon-data`), `figure`, `embed` (was `html-embed`), `checklist`. Old names are no longer recognised; `memon-data`'s `script/captured_*` provenance fields are removed.
- Executable payloads: a YAML block carrying reserved `script: <path>::<function>` or `code: |` (one `def`) is executed on explicit request; the remaining keys are passed as `**kwargs` together with injected `__id`, `__md_file_path`, `__project_root`, `__assets_dir`; the returned JSON object is the component's data.
- Execution results are cached as `<document dir>/<document stem>__assets/<id>.json` with hidden `__md_file_path`, `__component_type`, `__component_id`, `__updated_at` keys; a failed run keeps the previous data and records `__last_error`. Recompute is triggered by `memon components run <document> [--id …]` or by an owner-only button on executable blocks that reports updated / unchanged / failed.
- `datatable@1` gains `views[]`: `table`, `line`, `bar` with `x`, `y`, and optional `series`, `tabs`, `select` columns (tabs outer, select inner, orthogonal).
- `figure@1` takes `image` as a path relative to the document or absolute inside a configured project root; the shared `docs/wiki/assets` figure storage and slug rule are removed.
- Single source of truth: descriptors under `apps/web/lib/components/<type>/v<N>/` generate the registry barrel, the renderer barrel, core's structural component name list, and the `memon-components` skill's component table via `scripts/component-docs.mjs --write|--check`.
- **BREAKING**: `memon wiki components ls|show|migrate` and `GET|POST /api/wiki/components*` are removed; `memon-author-components` is retired and replaced by the generated `memon-components` skill. Automatic block migration is dropped (outdated pinned blocks still render and are flagged).

## Capabilities

### New Capabilities

- `document-components`: declaration syntax, payload forms, registry/descriptor contract, rendering on every Markdown surface, generated documentation, and the four shipped components' schemas.
- `component-execution`: executable payloads, the per-document `__assets` cache, recompute through CLI and dashboard, failure semantics, and the document asset route that serves cache files and figure images.

### Modified Capabilities

- `wiki-store`: the four component requirements (single container, versioning, every-surface rendering, data-block provenance) are replaced by references to the new capabilities; the data-block staleness token is removed.
- `wiki-cli`: `memon wiki components` is removed; `memon components run` is added.
- `memon-wiki-skill`: routing now names `memon-components`; the component table is generated, not fetched.
- `wiki-checklist-component`: declaration syntax updated; write-back only for static blocks.

## Impact

- `apps/web/lib/wiki-components/**` → `apps/web/lib/components/**` (new contract), `apps/web/components/wiki-components/**` → per-type renderers, `markdown.tsx` fence resolution, new recompute button and execution/cache API routes, document asset route, `packages/backend` execution service, `packages/cli` `components run`, `packages/core` generated name list, `packages/skills/memon-components` (+ retirement of `memon-author-components`), mock fixtures, docs.
- New Web dependency for charts (recharts via the shadcn Chart pattern).
- Distributed artifacts (CLI, skills) change → MINOR release.
