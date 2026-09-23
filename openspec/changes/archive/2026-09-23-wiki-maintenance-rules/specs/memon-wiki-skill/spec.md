## ADDED Requirements

### Requirement: Agents follow and maintain a page's maintenance rules

The skill SHALL document the maintenance rules section: fixed name (`Maintenance rules`, or `维护规则` on Chinese pages), last H2 of the page, list items only, one dated requirement per item, agent-specific requirements nested under a scope item worded `- Only for <agent>:`, and related rules optionally grouped under topic items ending with a colon at any depth. Every agent SHALL read a page's rules before editing it and follow those that apply to it, preserving rules scoped to other agents. When the owner puts the agent into maintenance mode for a page, the agent SHALL record every long-term requirement the owner states in that section without asking, SHALL edit or remove a rule the owner replaces or withdraws instead of adding a conflicting item, SHALL NOT record one-off instructions, and after each change SHALL tell the owner exactly which items were added, removed, or changed, quoting them. Outside maintenance mode a standing requirement the owner states explicitly about how a page is maintained SHALL be recorded and reported the same way.

#### Scenario: Owner states a standing requirement in maintenance mode
- **GIVEN** the agent is in maintenance mode for `W0012`
- **WHEN** the owner says that from now on Oh My Pi must never cancel an allocation
- **THEN** a dated item is added under `- Only for Oh My Pi:` in W0012's `## Maintenance rules` and the agent reports the added item verbatim

#### Scenario: Owner withdraws a rule
- **WHEN** the owner says an existing rule no longer applies
- **THEN** the item is removed, no deprecated marker is left in the section, and the agent reports the removed item verbatim
