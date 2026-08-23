## Why

Telegram is no longer a supported notification channel, but memon still ships
the `memon notify` command, Telegram configuration and rendering code, a bundled
notification skill, and workflows that ask agents to call it. Keeping that dead
surface misleads users, retains unused credentials, and lets installed skills
invoke a capability the project no longer intends to provide.

## What Changes

- **BREAKING** Remove the `memon notify` command family and all Telegram Bot API
  transport, message-rendering, credential-resolution, timeout, and test code.
- Remove Telegram from the typed configuration model. A legacy `telegram:` key
  remains loadable for migration compatibility, but loading it emits a warning
  that asks the operator to remove the block and its credentials; the values are
  ignored and never exposed through the loaded `Config` object.
- Remove the `memon-notify` bundled skill and all catalog, preflight, inventory,
  and code-review workflow references to it. Code-review completion returns to
  the normal in-conversation handoff.
- Remove Telegram setup documentation and configuration examples. Reinstalling
  bundled skills strictly synchronizes the `memon-*` namespace, so it removes
  previously installed `memon-notify` directories automatically.
- Remove the standalone `telegram-notify` capability from the active contract
  when this change is archived. Preserve archived add-change artifacts as
  historical records.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `telegram-notify`: remove the unsupported Telegram notification capability in
  full.
- `memon-cli`: remove the `notify` command/config-resolution exception and
  define the non-blocking warning for a legacy `telegram:` config key.
- `memon-skills`: remove `memon-notify` from the bundled inventory and remove
  the code-review completion notification dependency.

## Impact

- `packages/cli`: command registration, handler, and tests are removed.
- `packages/core`: Telegram config types/schema/loading, render helpers,
  auto-context helpers, exports, and focused tests are removed; config loading
  gains one redacted compatibility warning.
- `packages/skills`: the notification skill is deleted, the public inventory
  drops from eleven to ten skills, and code-review completion no longer performs
  an out-of-band side effect.
- `README.md` and `config.example.yml`: Telegram user guidance is removed.
- Existing `config.yml` files containing `telegram:` continue to load and run;
  stderr warns operators to remove the ignored credentials. Existing
  `MEMON_TELEGRAM_*` environment variables have no effect after this change.
- No dependency, database, or FS-convention migration is required.
