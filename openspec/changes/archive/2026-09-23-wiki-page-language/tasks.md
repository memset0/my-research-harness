## 1. Core and CLI

- [x] 1.1 Core: `WIKI_LANGUAGES`, frontmatter `language`, summary/detail `language`, `WIKI_LANGUAGE_INVALID`, backend protocol schema; kind registry `zh.headings` validation, bilingual `WIKI_MISSING_SECTION`, kind guidance with both forms; regenerate `page-kinds.md`; focused core tests.
- [x] 1.2 CLI: `--language` on `wiki create` (Chinese scaffold headings) and `wiki set`; focused CLI tests.

## 2. Web

- [x] 2.1 Wiki reading body `lang`; `BodyTranslation` `sourceLanguage`, target-aware labels, request schema, cache key, dedupe/batching and prompts; focused web tests.

## 3. Skill

- [x] 3.1 Rewrite the `memon-wiki` authoring-language guidance (default, explicit choice, declared language on update, terminology), skills tests.

## 4. Verification

- [x] 4.1 Typecheck, targeted tests, full local suite; browser check of a `language: zh` page (lang attribute, Chinese headings lint-clean, "Translate to English") on an isolated preview.
