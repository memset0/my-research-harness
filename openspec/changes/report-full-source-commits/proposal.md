## Why

Agents writing Reports (and Wiki pages) often record `source_commits` with abbreviated hashes. `memon refresh` then refuses the document ("source_commits must map repository names to full commit hashes"), and the page stays unpublished. The skills mention "full SHA" only in passing.

## What Changes

- The shared preflight names an abbreviated `source_commits` hash as the most common reason a refresh is refused.
- The Wiki maintenance reference and the Report skill (including the HTML bundle reference) require full 40-character hashes taken with `git rev-parse <revision>`, never abbreviated ones, and state the refusal they cause.

## Capabilities

### New Capabilities

### Modified Capabilities
- `memon-skills`: skills require full 40-character `source_commits` hashes and name the refusal they cause.

## Impact

`packages/skills` only. MINOR release; update cluster CLIs and refresh managed skills in projects.
