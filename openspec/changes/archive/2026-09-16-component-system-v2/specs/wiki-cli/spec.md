## REMOVED Requirements

### Requirement: `memon wiki components` reads the central registry
**Reason**: Component documentation is generated into the `memon-components` skill; the central component API is removed.
**Migration**: Read `packages/skills/memon-components/SKILL.md`; use `memon components run` to execute blocks.

## ADDED Requirements

### Requirement: `memon components run` executes a document's component blocks locally

`memon components run <document> [--id <id>]…` SHALL run inside the project (no central address), locate the executable component blocks of the given Markdown document (project-relative or absolute path inside the project), run every one or only the named ids, write each result to `<stem>__assets/<id>.json` per `component-execution`, print one JSON line per block (`{ id, status: "updated"|"unchanged"|"failed", path, durationMs, error? }`), and exit 0 only when every requested block succeeded (1 otherwise, 2 for a bad request such as an unknown id or a document without executable blocks when ids were named, 4 when the document does not exist). The CLI SHALL validate only that the function returned a JSON object; schema validation stays central. `memon wiki lint` SHALL keep structural-only component checks (`WIKI_COMPONENT_UNPINNED`, `COMPONENT_ID_DUPLICATE`) and the `--central` merge SHALL be removed with the API.

#### Scenario: Run one block
- **WHEN** `memon components run docs/wiki/note/W0004-x.md --id fid`
- **THEN** only `fid` executes and `docs/wiki/note/W0004-x__assets/fid.json` is written

#### Scenario: Unknown id
- **WHEN** `--id nope` names no executable block of the document
- **THEN** the command exits 2 and lists the executable ids
