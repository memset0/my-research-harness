# component-execution Specification

## Purpose

TBD

## Requirements

### Requirement: Executable payloads name a Python function and pass the rest as kwargs

A `yaml` component payload SHALL be executable when it carries exactly one of the reserved top-level keys `script` (`"<path>::<function>"`, path relative to the containing document or absolute inside a configured project root, function a Python identifier) or `code` (a block scalar containing exactly one top-level `def`). Both keys present, neither shape valid, a path outside every project root, or a `code` body with zero or several top-level `def`s SHALL be `WIKI_COMPONENT_INVALID`. Every other top-level key SHALL be passed to the function as a keyword argument, together with the injected keys `__id`, `__md_file_path` (project-relative document path), `__project_root`, and `__assets_dir` (project-relative cache directory). No schema SHALL declare `script`, `code`, or any `__`-prefixed field. The function SHALL run with the project root as working directory using the project's configured Python command (default `python3`), under a timeout (default 120 s), and SHALL return a JSON-serialisable object, which becomes the component's payload object.

#### Scenario: Script file with kwargs
- **WHEN** a block has `script: ../scripts/fid.py::collect`, `run_dir: logs/x-260901-010203`
- **THEN** `collect(run_dir="logs/x-260901-010203", __id=…, __md_file_path=…, __project_root=…, __assets_dir=…)` is invoked from the project root and its return value is the payload

#### Scenario: Inline function
- **WHEN** a block has `code: |` with one `def collect(**kw): …` and other keys
- **THEN** that function is invoked with the same keyword contract

#### Scenario: Non-object return is a failure
- **WHEN** the function returns a list or raises
- **THEN** the run fails with the error text and no cache data is replaced

### Requirement: Results are cached as `<stem>__assets/<id>.json` beside the document

For a document `<dir>/<stem>.md` the cache directory SHALL be `<dir>/<stem>__assets/`; each executable block with id `<id>` SHALL cache to `<id>.json` containing the returned object plus `__md_file_path`, `__component_type` (`<type>@<N>`), `__component_id`, `__updated_at` (ISO8601 with offset), `__source_hash` (sha256 over the resolved script text or code and the kwargs), and `__duration_ms`. An executable block without an id SHALL be `WIKI_COMPONENT_INVALID`. A cache file whose `__component_id` or `__component_type` does not match the block SHALL be ignored and reported. When no cache exists the block SHALL render a "not computed" notice naming the CLI command, plus the recompute button for owners. Wiki discovery SHALL ignore `*__assets` directories as pages; `memon wiki commit` SHALL stage a page's `__assets` directory with the page.

#### Scenario: First run writes the file
- **WHEN** `memon components run docs/wiki/note/W0004-x.md --id fid` succeeds
- **THEN** `docs/wiki/note/W0004-x__assets/fid.json` exists with the data and hidden keys and the page renders the data

#### Scenario: Bundle page
- **WHEN** the document is `docs/wiki/note/W0004-x/README.md`
- **THEN** the cache directory is `docs/wiki/note/W0004-x/README__assets/`

### Requirement: Recompute is explicit and reports updated, unchanged, or failed

Recompute SHALL happen only on explicit request: `memon components run <document> [--id <id>…]` (runs every executable block of the document or only the named ids, prints one JSON result per block, exits non-zero when any block failed) and, on dashboard surfaces with a known document path, an owner-only recompute button on each executable block (hidden on static blocks, disabled for viewers and while a run is pending). After a successful run the result SHALL be compared to the cached data as canonical JSON: different → the cache file is rewritten, the rendered block refreshes, and the button reports "updated"; identical → only `__updated_at` and `__duration_ms` change and the button reports "unchanged". On failure the cached data SHALL be preserved, `__last_error { at, message }` SHALL be written, the button SHALL report the failure, the CLI SHALL print it, and the rendered block SHALL keep showing the previous data with a failure notice. Dashboard recompute SHALL require owner authentication and a project whose execution kind is local; other projects SHALL show the button disabled with the reason.

#### Scenario: Unchanged result
- **WHEN** the owner presses recompute and the function returns the same object
- **THEN** the button shows "unchanged" and `data` bytes in the cache are identical

#### Scenario: Failure keeps data
- **WHEN** the function raises after a previous success
- **THEN** the previous data remains rendered, the cache keeps it, `__last_error` records the message, and the button shows the error

#### Scenario: CLI partial failure
- **WHEN** `memon components run page.md` runs three blocks and one fails
- **THEN** two cache files are updated, the failing block's file keeps its data, the command exits 1 and names the failing id

### Requirement: Document assets are served through a path-safe route

The dashboard SHALL serve `<stem>__assets/<file>` cache files and figure images and videos through a document asset route addressed by project and document path; every request SHALL resolve the real path and refuse anything outside the configured project roots or containing traversal, encoded separators, or NUL. Cache JSON SHALL be served with `Cache-Control: no-store`; images and videos with a content type derived from the extension (svg, png, jpg, jpeg, webp, gif, avif; mp4, webm) and a restrictive CSP for SVG. Byte-range requests SHALL be answered with `206 Partial Content` so a browser can read video metadata and seek without downloading the whole file.

#### Scenario: Traversal refused
- **WHEN** `/api/doc-assets/<project>/docs/wiki/note/W0004-x/../../../../config.yml` is requested
- **THEN** the route answers 400 without reading the file

#### Scenario: Video range request
- **WHEN** a figure video `rollout.mp4` is requested with `Range: bytes=0-1023`
- **THEN** the route answers 206 with `content-type: video/mp4` and exactly those 1024 bytes
