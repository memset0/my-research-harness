## Context

The skill records owner-stated long-term requirements automatically in maintenance mode and reports each change. It has no path for agent-identified lessons and no size discipline.

## Decisions

1. **Origin decides authorization.** Owner-stated rules (including "never do X again" after an incident) are recorded directly; agent-identified error patterns are proposals. The proposal quotes the item, scope (`Only for <agent>:` or all agents), topic, and evidence (date, what failed, where it is recorded). Approval adds it dated with the approval day; decline records nothing, and the same incident is not proposed again without new evidence.
2. **Rule shape for error patterns.** A preventive instruction ("Never X; do Y instead") with the cause in a short clause only when the instruction alone would look arbitrary. The incident narrative stays in the Experiment or the page body.
3. **Compression is part of every edit.** Before adding, look for the rule it refines or duplicates and edit that rule instead. Merge overlapping rules and replace several specific rules with one general rule only when the general rule requires everything they did. Dropping or weakening a requirement is a removal and needs the owner's word. Every merge is reported as a change with the replaced items quoted; a merged rule carries the latest date among its sources.
4. No lint change: size and overlap are judgement, not structure.
