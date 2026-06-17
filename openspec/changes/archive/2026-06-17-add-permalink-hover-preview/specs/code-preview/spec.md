## ADDED Requirements

### Requirement: Per-project GitHub-to-local repo mapping in config

Project config SHALL support an optional per-project `github` list; each entry
maps a GitHub `owner`/`repo` to a local path:
`{ owner: string, repo: string, path: string }`, where `path` is relative to the
project root (`.` = the main repo, otherwise a submodule path). The mapping SHALL
be validated at config load and exposed on the typed `ProjectConfig`. When no
entry matches a given `owner/repo`, no preview is available for that repo and the
caller SHALL handle it gracefully (not an error).

#### Scenario: Mapping parsed and resolved to an absolute local path

- **GIVEN** a project with `github: [{ owner: acme, repo: proj, path: . }]` and root `/r/proj`
- **WHEN** config loads
- **THEN** the typed `ProjectConfig.github[0]` resolves `path` to `/r/proj` (root-relative resolved against the project root)

#### Scenario: No github mapping is valid

- **WHEN** a project omits `github`
- **THEN** config still loads and the project simply offers no code previews

### Requirement: GET /api/code-preview returns local code for a GitHub permalink

`GET /api/code-preview?project=<name>&url=<github-permalink>` SHALL parse the
permalink into `owner` / `repo` / `sha` / `path` / line range, resolve
`owner/repo` to a local repo via the project's `github` mapping, read the file at
`<sha>:<path>` from that **local** repo (no network), and return
`{ owner, repo, sha, path, startLine, endLine, lines, truncated }`. `lines` is an
array of `{ n: number, text: string, target: boolean }` covering the referenced
range plus a fixed context window above and below (clamped to the file), where
`target` is true for the lines the permalink points at. When the window exceeds a
maximum line cap, `truncated` SHALL be true.

#### Scenario: Single-line and range permalinks

- **WHEN** the url ends with `#L42` (or `#L42-L58`)
- **THEN** the response's `target` lines are line 42 (or 42–58), surrounded by context lines with `target: false`

#### Scenario: Reads at the pinned sha, no network

- **WHEN** a valid permalink for a mapped repo is requested
- **THEN** the content is read from the local repo at the permalink's sha via local git, with no request to github.com

#### Scenario: Owner/repo not mapped

- **WHEN** the permalink's `owner/repo` has no entry in the project's `github` mapping
- **THEN** the response is 404 NOT_FOUND (the client falls back to a plain link)

#### Scenario: Unparseable or non-blob url

- **WHEN** `url` is missing, not a GitHub `blob` line-permalink, or has no `#L` anchor
- **THEN** the response is 400 BAD_REQUEST

#### Scenario: Missing file or sha

- **WHEN** the mapped repo has no such `path` at that `sha` (e.g. an unfetched commit)
- **THEN** the response is 404 NOT_FOUND

### Requirement: Code-preview is logged-in-only and path-safe

The route SHALL be classified `read` and scoped to `?project=`: an owner passes,
a viewer passes only if the project is in their share scope, and an
unauthenticated caller is rejected. The resolved local repo root AND the resolved
file path SHALL both be validated by `assertWithinProjectRoots()`; a path that
escapes the configured roots SHALL return 403 FORBIDDEN. These two controls
together prevent an unauthenticated or out-of-scope caller from reading private
repo source through the endpoint.

#### Scenario: Anonymous caller rejected

- **WHEN** an unauthenticated request hits `/api/code-preview`
- **THEN** it is rejected by the auth layer (401, or its HTML 302→/login rewrite) before any file is read

#### Scenario: Out-of-scope viewer rejected

- **WHEN** a viewer whose scope does not include `<project>` requests a preview for it
- **THEN** the response is 403 FORBIDDEN

#### Scenario: Path traversal blocked

- **WHEN** a crafted url resolves to a path outside the configured project roots
- **THEN** the response is 403 FORBIDDEN and nothing is read
