## ADDED Requirements

### Requirement: Pages are written in their declared language

The skill SHALL write new pages in English unless the user asks for Chinese for that page or states it as a preference for the task, in which case the page SHALL be created with `language: zh` and written in Chinese (title, description, headings, prose, table text). Updates SHALL keep an existing page's declared language; a conversation held in Chinese SHALL NOT by itself switch a page's language. A language switch SHALL happen only on request, as a faithful whole-page rewrite that changes no claims or sources, together with the `language` field, in one wiki commit. In Chinese prose the skill SHALL keep in English: artifact identifiers, paths, code, column, Variant, metric and config names, method, model and library names, acronyms, and technical terms with no standard unambiguous Chinese rendering; frontmatter enums and slugs SHALL stay unchanged.

#### Scenario: User asks for a Chinese page
- **WHEN** the user asks for a finding about KV-cache memory "用中文写"
- **THEN** the page is created with `--language zh`, uses the Chinese headings, and keeps terms such as `KV cache`, `FP8`, and `E0017` in English

#### Scenario: Updating an English page from a Chinese conversation
- **GIVEN** an English page and a user who discusses it in Chinese without asking for a language change
- **WHEN** the skill records the agreed update
- **THEN** the update is written in English and `language` is unchanged
