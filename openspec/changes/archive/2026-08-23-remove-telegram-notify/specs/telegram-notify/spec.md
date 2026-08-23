## REMOVED Requirements

### Requirement: `memon notify <severity>` sends a push to Telegram

**Reason**: Telegram is no longer a supported notification channel, so memon
must not expose a send command or perform Telegram Bot API requests.

**Migration**: Remove calls to `memon notify`; report completion, failures, and
questions through the active agent conversation or another separately supported
integration.

### Requirement: `memon notify test` is a self-test

**Reason**: The transport and command family being tested are removed.

**Migration**: Remove Telegram notification health checks and their credentials
from operational setup.

### Requirement: Telegram credentials resolution order

**Reason**: Memon no longer consumes Telegram credentials from configuration or
environment variables.

**Migration**: Delete `telegram:` from `config.yml` and unset
`MEMON_TELEGRAM_BOT_TOKEN`, `MEMON_TELEGRAM_CHAT_ID`, and
`MEMON_TELEGRAM_TIMEOUT_MS`.

### Requirement: Message assembly + MarkdownV2 escape

**Reason**: Telegram-specific message rendering has no remaining caller after
the transport is removed.

**Migration**: No application data migration is required; downstream code must
stop importing the removed Telegram rendering helpers.

### Requirement: Severity → emoji + tag mapping (stable)

**Reason**: The severity vocabulary existed only for Telegram notification
payloads.

**Migration**: Present status in the normal command or conversational output
instead of constructing a Telegram severity header.

### Requirement: Auto-appended context footer

**Reason**: The footer was part of Telegram message assembly and is no longer a
supported output contract.

**Migration**: Include relevant project, run, agent, or session context directly
in the active handoff when needed.

### Requirement: Agent kind and session resolution

**Reason**: Agent/session resolution existed only to annotate Telegram
notifications.

**Migration**: Remove consumers of the notification-only agent/session helper;
no persisted data conversion is required.

### Requirement: HTTP timeout and retry policy

**Reason**: Memon no longer sends requests to the Telegram Bot API.

**Migration**: Remove `MEMON_TELEGRAM_TIMEOUT_MS`; there is no replacement
transport timeout in this change.
