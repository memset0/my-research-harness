## Why

v6.13.0 gave Chinese pages translated section headings (结论 / 证据 / 局限, `## 维护规则`). The owner wants section headings to stay English on every page so structure, anchors, lint and cross-page references read the same regardless of content language, and wants the agent rules section named so that it is unmistakably addressed to agents.

## What Changes

- Section headings are English on every page; Chinese pages keep Chinese title, description, prose and tables. **BREAKING** for pages written with the v6.13.0 Chinese heading forms: they are no longer recognized.
- The kind registry drops `zh.headings`; lint matches recommended sections by English text only; `memon wiki create --language zh` scaffolds the English H2s; kind guidance and `wiki kinds show` list English headings only.
- The rules section is renamed `## Maintenance rules for agents` (single English name, no Chinese form); lint recognizes only that name.
- The `memon-wiki` skill states the English-heading rule and the new section name.
- CLI, skills and core change -> MINOR release; the operator's existing rules section is renamed in the same rollout.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-store`: English-only section matching; rules section name.
- `wiki-kind-registry`: no translated heading forms.
- `wiki-cli`: `create --language zh` scaffolds English H2s.
- `memon-wiki-skill`: English section headings on Chinese pages; rules section name.

## Impact

- `packages/core/src/wiki/{kinds.json,kind-registry.ts,kind-guidance.ts,lint.ts,types.ts}` (+ tests), `packages/cli/src/commands/wiki.ts` (+ tests), regenerated `packages/skills/memon-wiki/references/page-kinds.md`, `packages/skills/memon-wiki/SKILL.md`.
