## Context

`memon-wiki` mandates English content (SKILL.md "Authoring language"). Body translation is English → Simplified Chinese only: `TranslationRequestSchema.targetLanguage` is `z.literal('zh-CN')`, the cache key hard-codes `'zh-CN'`, and both prompts (`service.ts`, `codex.ts` base instructions) say "into Simplified Chinese". Wiki frontmatter preserves unknown keys; recommended H2s come from `kinds.json` `policy.recommendedHeadings` and are matched case-insensitively by exact text in `lint.ts`, and `memon wiki create` scaffolds them.

## Goals / Non-Goals

- Goal: a durable per-page language the agent writes in and every later writer keeps; readers can still translate into the other language.
- Non-goal: languages beyond English and Chinese, project-wide language defaults, automatic language detection, or language fields on Experiments/Reports/Runs (their translation stays English → Chinese).

## Decisions

1. **Field**: `language: en | zh` in wiki frontmatter, optional, absent = `en`. Core exports `WIKI_LANGUAGES = ['en', 'zh'] as const` and `type WikiLanguage`. `WikiSummary.language: WikiLanguage` (invalid → `en`). Invalid value → `WIKI_LANGUAGE_INVALID`, severity `error`, page still listed (same policy as `WIKI_STATUS_INVALID`). Backend protocol summary schema: `language: z.enum(['en','zh']).default('en')` so an older backend's response still parses.
2. **Headings**: each kind's `zh` block gains `headings: string[]`, the same length and order as `policy.recommendedHeadings`, non-empty, unique within the kind; validation fails otherwise. Chinese forms: meeting 参会人/记录/决定/行动项; finding 结论/证据/局限; bottleneck 问题/影响/状态/候选方案; showcase 展示内容/复现方法/素材; question 问题/背景/答案; decision 决定/理由/影响; harness-feedback 动机/提议/状态. Lint accepts either form for every page (no language-dependent rejection); the warning names the form of the page's language with the other form in parentheses. `create --language zh` scaffolds the Chinese forms. Kind guidance lists both forms.
3. **CLI**: `--language <en|zh>` on `create` (writes `language: zh`; for `en` the field is written only when passed explicitly) and on `set` (counts as a change flag; invalid value exits 2). `ls`/`show` JSON carry the summary's `language`.
4. **Viewer**: the wiki reading body element gets `lang="en"` or `lang="zh-CN"`.
5. **Translation direction**: `BodyTranslation` takes `sourceLanguage?: 'en' | 'zh'` (default `en`); target = `zh-CN` for `en`, `en` for `zh`; button label "Translate to Chinese" / "Translate to English"; translated blocks carry the target `lang`. `targetLanguage: z.enum(['zh-CN', 'en'])`; cache key, in-flight dedupe and queued batches key on the target (a batch never mixes targets); both prompts are parameterized ("into Simplified Chinese" / "into English"). The server does not second-guess the requested direction (owner-only action).
6. **Skill**: English by default; a page is written in Chinese when the user asks for it (for that page or as a stated preference for the task), created with `--language zh` or switched with `set --language zh` in the same commit as a faithful whole-page rewrite; existing pages are updated in their declared language; a conversation in Chinese alone does not switch a page. Terminology rule: identifiers, paths, code, column/Variant/metric names, config keys, method/model/library names, acronyms and technical terms without a standard unambiguous Chinese rendering stay in English inside Chinese prose; frontmatter enums and slugs are unchanged.

## Risks / Trade-offs

- Heading forms in two languages mean anchors differ by language; cross-page links target pages, not headings, so nothing depends on English anchors.
- A page whose declared language disagrees with its content translates in the wrong direction; the skill keeps the field and content together, and the reader can still read the original.

## Migration Plan

None: the field is optional, every existing page is `en`. Release as MINOR (CLI + skills + central); reinstall skills in consuming projects.
