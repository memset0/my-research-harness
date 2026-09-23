## MODIFIED Requirements

### Requirement: Pages are written in their declared language

The skill SHALL write new pages in English unless the user asks for Chinese for that page or states it as a preference for the task, in which case the page SHALL be created with `language: zh` and written in Chinese (title, description, prose, table text) while every section heading stays in English. Updates SHALL keep an existing page's declared language; a conversation held in Chinese SHALL NOT by itself switch a page's language. A language switch SHALL happen only on request, as a faithful whole-page rewrite that changes no claims or sources, together with the `language` field, in one wiki commit. In Chinese prose the skill SHALL keep in English: artifact identifiers, paths, code, column, Variant, metric and config names, method, model and library names, acronyms, and technical terms with no standard unambiguous Chinese rendering; frontmatter enums and slugs SHALL stay unchanged.

#### Scenario: User asks for a Chinese page
- **WHEN** the user asks for a finding about KV-cache memory "用中文写"
- **THEN** the page is created with `--language zh`, keeps the English section headings `Claim`, `Evidence`, `Limits`, and keeps terms such as `KV cache`, `FP8`, and `E0017` in English

#### Scenario: Updating an English page from a Chinese conversation
- **GIVEN** an English page and a user who discusses it in Chinese without asking for a language change
- **WHEN** the skill records the agreed update
- **THEN** the update is written in English and `language` is unchanged

### Requirement: Agents follow and maintain a page's maintenance rules

The skill SHALL document the maintenance rules section: fixed English name `Maintenance rules for agents` on every page, last H2 of the page, list items only, one dated requirement per item, agent-specific requirements nested under a scope item worded `- Only for <agent>:`, and related rules optionally grouped under topic items ending with a colon at any depth. Every agent SHALL read a page's rules before editing it and follow those that apply to it, preserving rules scoped to other agents. When the owner puts the agent into maintenance mode for a page, the agent SHALL record every long-term requirement the owner states in that section without asking, SHALL edit or remove a rule the owner replaces or withdraws instead of adding a conflicting item, SHALL NOT record one-off instructions, and after each change SHALL tell the owner exactly which items were added, removed, or changed, quoting them. Outside maintenance mode a standing requirement the owner states explicitly about how a page is maintained SHALL be recorded and reported the same way.

#### Scenario: Owner states a standing requirement in maintenance mode
- **GIVEN** the agent is in maintenance mode for `W0012`
- **WHEN** the owner says that from now on Oh My Pi must never cancel an allocation
- **THEN** a dated item is added under `- Only for Oh My Pi:` in W0012's `## Maintenance rules for agents` and the agent reports the added item verbatim

#### Scenario: Owner withdraws a rule
- **WHEN** the owner says an existing rule no longer applies
- **THEN** the item is removed, no deprecated marker is left in the section, and the agent reports the removed item verbatim
