## 1. Skill guidance

- [x] 1.1 Add the "Images for figures" section to `packages/skills/memon-components/SKILL.md` (document-local storage, byte preservation, authorization before download/insert, no hotlinks, self-contained SVG, grounded descriptions) and mirror it to `.claude/skills/memon-components/SKILL.md`; verify `node scripts/component-docs.mjs --check` and `pnpm --filter @memon/skills exec vitest run` pass and the grep scenarios in the delta hold

## 2. Spec alignment

- [x] 2.1 Replace the superseded `wiki-store` delta with the `document-components` SVG-as-image scenario and rewrite the `memon-wiki-skill` delta for `memon-components`; verify `openspec validate wiki-figure-component --type change`
