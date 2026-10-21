## Why

Agents still create new Reports as standalone `docs/reports/R<NNNN>-<slug>.md` files, although new Wiki pages and Reports are folders. The Report skill states the folder rule in a half sentence followed by "preserve existing working paths", which reads as permission for standalone files.

## What Changes

- The Report skill, the Wiki skill and the shared maintenance reference state that every new Report or Wiki page is a folder with `README.md` (Markdown) or `manifest.json` (HTML/service), forbid new standalone `.md` files, and say that existing standalone documents stay readable and keep their paths.

## Capabilities

### New Capabilities

### Modified Capabilities
- `memon-skills`: skills forbid new standalone Report and Wiki files.

## Impact

`packages/skills` only. MINOR release; update cluster CLIs and refresh managed skills in projects.
