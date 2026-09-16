## Context

`component-system-v2` replaced the figure contract this change originally proposed (shared `docs/wiki/assets`, slug-bound `src`, CLI field reference). The renderer already uses `<img>` with a caption/description fallback and the asset route already applies an SVG CSP, so the only unshipped part is the skill's authoring boundary.

## Decisions

- Put the guidance in the hand-written part of `packages/skills/memon-components/SKILL.md` as an "Images for figures" section directly before "Checklist flags are a human boundary"; the generated table stays untouched. Mirror to `.claude/skills/memon-components/SKILL.md` (the generator's `--check` verifies the mirror).
- Do not re-add shared asset storage; `<stem>__assets/` beside the document is the convention (`document-components`).
- No code change; the SVG-as-image behaviour is documented as a scenario on the existing `figure@1` requirement.

## Risks / Trade-offs

- A skills change alone triggers a MINOR release by policy; accepted so nodes pick up the guidance through `memon update`.
