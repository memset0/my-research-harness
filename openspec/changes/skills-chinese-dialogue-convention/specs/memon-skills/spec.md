## ADDED Requirements

### Requirement: Inline Chinese dialogue SHALL use the `(in Chinese):` + blockquote convention

When a SKILL.md embeds a Chinese-language sample of what the agent should literally say to the user, the dialogue SHALL be formatted as a markdown blockquote (`> ...`), and the prose immediately preceding the blockquote SHALL end with the literal marker `(in Chinese):`.

The blockquote SHALL NOT wrap its content in `"..."` quotes — the `>` itself is the quoting device. Each `>` line SHALL be followed by either a space (then the quoted text) or nothing (an empty quoted line); a `>` directly followed by a non-space character is a formatting error.

The variants `(Chinese):` (without "in") and `In Chinese:` (without parens, capital I) SHALL NOT appear as lead-ins to Chinese blockquotes; both forms are normalised to `(in Chinese):`.

This requirement applies only to literal-dialogue samples. It does NOT apply to:

- Agent-facing instructional bullets that happen to contain Chinese tokens (e.g. a bullet describing what content the agent should walk the user through, where Chinese is one of the bullet's words rather than a sample utterance).
- Parenthetical example phrasings inside regular prose (e.g. `(e.g. "...")`) — those use ordinary inline quotes, not blockquotes, and need no `(in Chinese):` lead-in.

#### Scenario: Every Chinese blockquote has the `(in Chinese):` lead-in
- **WHEN** a reader scans every blockquote (`^>` line) across `packages/skills/memon-*/SKILL.md` whose content contains Han characters
- **THEN** for each such blockquote, the nearest preceding non-empty line (within the same paragraph / list item) ends with the literal substring `(in Chinese):`

#### Scenario: No deprecated lead-in variants survive
- **WHEN** a reader runs `grep -E '\((Chinese)\):|In Chinese:' packages/skills/memon-*/SKILL.md` (case-sensitive on `In`)
- **THEN** the output contains no lines (every previous occurrence has been normalised)

#### Scenario: Blockquote lines are well-formed
- **WHEN** a reader scans every line beginning with `>` in a Chinese-dialogue blockquote
- **THEN** the character after `>` is either a space, a newline, or end-of-file (no `>` immediately followed by a non-space content character)
