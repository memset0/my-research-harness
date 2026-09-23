## Context

v6.13.0 added `zh.headings` to every kind, `WIKI_RECOMMENDED_SECTION_FORMS` (en/zh pairs, replacing `WIKI_RECOMMENDED_SECTIONS`), bilingual `WIKI_MISSING_SECTION` matching and messages, a Chinese scaffold for `create --language zh`, and `WIKI_MAINTENANCE_RULES_HEADINGS = { en: 'Maintenance rules', zh: '维护规则' }`.

## Decisions

1. Remove `zh.headings` from `kinds.json` and the registry schema; restore an English-only export `WIKI_RECOMMENDED_SECTIONS: Record<kind, readonly string[]>` and delete `WIKI_RECOMMENDED_SECTION_FORMS` (clean cutover; migrate every consumer).
2. `WIKI_MISSING_SECTION` matches English headings case-insensitively on every page; message `recommended \`<kind>\` section "<Heading>" is missing` (no parenthesized translation).
3. `create --language zh` writes `language: zh` and the same English scaffold as `en`. Kind guidance and `wiki kinds show` list English headings only.
4. Replace `WIKI_MAINTENANCE_RULES_HEADINGS` with `WIKI_MAINTENANCE_RULES_HEADING = 'Maintenance rules for agents'`; lint recognizes only that heading (trimmed, case-insensitive) and reports a second one. `## Maintenance rules` without "for agents" is ordinary content.
5. No lint for non-English headings: the skill carries the rule, and a Chinese recommended heading already surfaces as `WIKI_MISSING_SECTION`.

## Migration

Pages created with v6.13.0 Chinese headings or `## Maintenance rules` need their headings renamed; the operator's project has one such section, renamed during rollout.
