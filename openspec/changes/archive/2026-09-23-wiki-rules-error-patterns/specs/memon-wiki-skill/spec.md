## MODIFIED Requirements

### Requirement: Agents follow and maintain a page's maintenance rules

The skill SHALL document the maintenance rules section: fixed English name `Maintenance rules for agents` on every page, last H2 of the page, list items only, one dated requirement per item, agent-specific requirements nested under a scope item worded `- Only for <agent>:`, and related rules optionally grouped under topic items ending with a colon at any depth. Every agent SHALL read a page's rules before editing it and follow those that apply to it, preserving rules scoped to other agents. When the owner puts the agent into maintenance mode for a page, the agent SHALL record every long-term requirement the owner states in that section without asking, SHALL edit or remove a rule the owner replaces or withdraws instead of adding a conflicting item, SHALL NOT record one-off instructions, and after each change SHALL tell the owner exactly which items were added, removed, or changed, quoting them. Outside maintenance mode a standing requirement the owner states explicitly about how a page is maintained SHALL be recorded and reported the same way. The section SHALL stay compact: before adding a rule the agent SHALL fold it into an existing rule it refines or duplicates, and SHALL merge duplicate or overlapping rules and replace several specific rules with one general rule when the general rule requires everything they did; compression SHALL NOT drop or weaken a requirement without the owner's word, and every merge SHALL be reported with the replaced items quoted. A recurring error pattern the agent identifies (an incident, a costly wrong assumption, a tooling trap) SHALL enter the section only after the owner authorizes it: the agent SHALL propose the exact item, its scope and topic, and the evidence, SHALL add it dated with the authorization day only on approval, and SHALL record nothing for a declined proposal. An error pattern the owner states as a rule is a requirement and is recorded directly.

#### Scenario: Owner states a standing requirement in maintenance mode
- **GIVEN** the agent is in maintenance mode for `W0012`
- **WHEN** the owner says that from now on Oh My Pi must never cancel an allocation
- **THEN** a dated item is added under `- Only for Oh My Pi:` in W0012's `## Maintenance rules for agents` and the agent reports the added item verbatim

#### Scenario: Owner withdraws a rule
- **WHEN** the owner says an existing rule no longer applies
- **THEN** the item is removed, no deprecated marker is left in the section, and the agent reports the removed item verbatim

#### Scenario: New requirement refines an existing rule
- **GIVEN** the rules contain `- Validate every 100 steps. (2026-09-13)`
- **WHEN** the owner says validation must also run at step 0
- **THEN** that item becomes one rule covering both requirements, no second validation item is added, and the agent reports the change with the old item quoted

#### Scenario: Agent-identified error pattern awaits authorization
- **GIVEN** two concurrent jobs failed because they shared a fixed rendezvous port
- **WHEN** the agent identifies the pattern
- **THEN** it proposes the quoted rule with its scope and evidence and leaves the section unchanged until the owner approves

#### Scenario: Declined error pattern
- **WHEN** the owner declines a proposed error-pattern rule
- **THEN** nothing is recorded in the section
