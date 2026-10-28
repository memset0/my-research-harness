## ADDED Requirements

### Requirement: Code blocks offer Copy all

Each ordinary fenced code block in rendered Markdown SHALL show a "Copy all" button on hover or keyboard focus that writes the block's plain text to the clipboard (with a fallback where the Clipboard API is unavailable) and then reads "Copied" briefly. Wiki component blocks SHALL be unaffected.

#### Scenario: Copy a command
- **WHEN** the reader clicks "Copy all" on a fenced block
- **THEN** the clipboard holds the block's text without markup
