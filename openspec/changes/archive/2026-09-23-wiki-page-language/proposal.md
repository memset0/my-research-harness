## Why

The wiki skill requires every page to be written in English and expects readers who prefer Chinese to use the dashboard's on-demand translation. The owner wants to choose, per page, whether its content is presented in English or Chinese by telling the agent while the page is written, with the translation action kept for reading a page in the other language. When writing Chinese, established technical terms should stay in English so their meaning is not blurred by an ad-hoc rendering.

## What Changes

- Wiki page frontmatter gains an optional `language: en | zh` (absent = `en`); an unknown value is a `WIKI_LANGUAGE_INVALID` error diagnostic and the page reads as English. Page summaries and details expose `language`.
- The kind registry gives every recommended H2 a Chinese form (e.g. `finding`: 结论 / 证据 / 局限); `WIKI_MISSING_SECTION` accepts either form, and `memon wiki create --language zh` scaffolds the Chinese headings.
- `memon wiki create` and `memon wiki set` accept `--language <en|zh>`.
- The wiki reading body carries a matching `lang` attribute. The translation action translates an `en` page into Simplified Chinese (unchanged) and a `zh` page into English ("Translate to English"); experiment documents and reports stay English → Chinese.
- The `memon-wiki` skill replaces its English-only rule: English by default, the language the user asks for when they ask, the page's declared language on later updates, a whole-page rewrite only on request, and technical terms, identifiers, metric/method/model names and acronyms kept in English inside Chinese prose. The generated kind reference lists both heading forms.
- Distributed artifacts (CLI, skills) and central change → MINOR release. No filesystem convention bump: the field is optional and existing pages stay valid.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wiki-store`: `language` frontmatter field and its diagnostic; recommended sections accept Chinese forms.
- `wiki-kind-registry`: Chinese forms of recommended headings are part of the validated configuration.
- `wiki-cli`: `--language` on `create` and `set`.
- `body-translation`: translation direction follows the wiki page's declared language.
- `wiki-viewer`: the reading body declares its language.
- `memon-wiki-skill`: pages are written in their declared language with English technical terms.

## Impact

- `packages/core/src/wiki/{types,summary,lint,kind-registry,kind-guidance}.ts`, `kinds.json`, `backend-protocol.ts`; `packages/cli/src/{index.ts,commands/wiki.ts}`; `apps/web/components/{wiki-shell,body-translation}.tsx`, `apps/web/lib/translation/{http,service,codex}.ts`; `packages/skills/memon-wiki/{SKILL.md,references/page-kinds.md}`.
