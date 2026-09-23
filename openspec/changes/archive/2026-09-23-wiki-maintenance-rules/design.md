## Context

Wiki bodies are free Markdown; lint already scans H2s (`H2_REGEX`) on a code-masked body. The `memon-wiki` skill forbids deleting historical claims ("Deprecate, never delete"). `wiki-page-language` (in flight) introduces `language: zh` and Chinese heading forms.

## Decisions

1. **Name and place**: one H2 named `Maintenance rules` or `维护规则` (either form is recognized on any page; the skill writes the page-language form), placed as the page's last H2. Core exports `WIKI_MAINTENANCE_RULES_HEADINGS = { en: 'Maintenance rules', zh: '维护规则' }`.
2. **Format**: inside the section every non-blank line is a list item (`-`, `*`, `+`, or `1.`) or an indented line belonging to one (continuation or nested item). Scope items read `- Only for <agent>:` and topic items end with a colon (both state no requirement and may nest); each requirement ends with the date the owner stated it, `(YYYY-MM-DD)`. Lint checks only structure (list-only, single section); scope wording and dates are skill conventions, not diagnostics.
3. **Diagnostic**: `WIKI_MAINTENANCE_RULES_INVALID`, severity `warn`, line of the first offending line (or of the second heading); page stays valid. Code blocks are already masked, so a fenced block inside the section counts as offending text through its fence line.
4. **Skill**: rules bind every editing agent (scoped groups bind only their agent, others preserve them). Maintenance mode is entered on the owner's request for one page; long-term requirements are recorded without asking, one-off instructions are not; replaced or withdrawn rules are edited or removed (the section holds only current rules, git keeps history); every change is reported to the owner as quoted added/removed/changed items. Rule edits are ordinary wiki edits (lint, journal submit, `memon wiki commit`).
## Risks

- Over-recording: the skill limits recording to requirements meant to outlive the current request and requires the change report, so the owner sees and can revert each entry.
