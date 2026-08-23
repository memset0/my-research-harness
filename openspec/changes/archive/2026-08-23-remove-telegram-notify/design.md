## Context

The Telegram feature crosses four independently discoverable surfaces: the CLI
command, Core configuration/rendering helpers, bundled agent skills, and active
OpenSpec contracts. Removing only the skill would stop new agent discovery but
would leave the public command and credential schema supported; removing only
the command would leave installed skills instructing agents to call it.

The skill installer discovers bundled `memon-*` directories dynamically and
strictly replaces that namespace in each target, so source-directory deletion
already provides an installed-copy migration path. OpenSpec archive artifacts
are historical records and must not be rewritten.

## Goals / Non-Goals

**Goals:**

- Remove every executable Telegram notification path and public skill entry.
- Keep legacy instance configurations usable while clearly prompting operators
  to delete stored Telegram credentials.
- Make removed skills disappear on the next normal `install-skills` sync.
- Leave the active change in a state that can later be archived to remove the
  `telegram-notify` capability from the main specifications.

**Non-Goals:**

- Introduce another notification provider or a provider-neutral abstraction.
- Preserve `memon notify` as a deprecated stub.
- Migrate or delete operator-owned `config.yml` files automatically.
- Warn about legacy `MEMON_TELEGRAM_*` environment variables, which are not
  visible to configuration loading and simply become unused.
- Edit archived add-Telegram changes.

## Decisions

### D1. Remove the CLI surface instead of retaining a compatibility command

Delete command registration and its handler. After upgrade, `memon notify` is
an unknown command under the CLI parser, matching the fact that no notification
backend is supported.

Retaining a stub was rejected because it would keep a discoverable public
surface with no successful behavior and would invite skills or scripts to treat
it as a supported compatibility promise.

### D2. Detect the legacy key before schema validation, warn, then discard it

Remove Telegram from `ConfigRawSchema` and `Config`. Immediately after YAML
parsing, detect whether the raw top-level mapping owns a `telegram` key. If so,
write one static warning line to stderr for that load and continue normal
validation. Zod's default unknown-key stripping then discards the legacy value.

Detection happens before validation so incomplete, null, or otherwise malformed
legacy Telegram values cannot keep an unrelated valid deployment from starting.
The warning is a constant message and never interpolates the value, token, or
chat id. Configurations without the key remain quiet.

Returning warnings in the `Config` object was rejected because every CLI/web
caller would need new plumbing and callers that forgot to surface the new field
would silently retain credentials. Rejecting the key was rejected at the user's
direction because removal of an optional integration must not block serving.

### D3. Delete notification-only Core helpers as one unit

The Telegram renderer and its auto-context helper have no non-notification
callers. Delete both modules, their tests, and their barrel exports together
rather than leaving generic-looking utilities whose contracts were designed for
Telegram message footers.

If future work needs agent detection or a notification abstraction, it should
define that capability from current requirements instead of inheriting this
transport-specific API accidentally.

### D4. Replace code-review push delivery with an ordinary handoff

The code-review skill will finish by reporting the created/updated review path
in the active conversation. It will not substitute a durable journal event or
another external side effect: those have different ownership and retention
semantics.

### D5. Let strict skill synchronization remove installed copies

Delete the bundled `memon-notify` directory and its exported inventory entry.
Do not add a one-off deletion command. The existing installer already removes
every target-side `memon-*` directory before copying the current bundled set,
and its generic stale-skill regression covers this behavior.

### D6. Preserve historical specs until normal archive

This change carries deltas for `telegram-notify`, `memon-cli`, and
`memon-skills`. It does not directly edit the active main specs while the change
is open and never edits `openspec/changes/archive`. Archiving the completed
change is the operation that removes the standalone main capability and merges
the updated CLI/skill contracts.

## Risks / Trade-offs

- **[Risk]** A warning on every configuration load can repeat if a host reloads
  config repeatedly. **Mitigation:** use one concise line per load; removing the
  legacy block permanently eliminates it without hidden process-global state.
- **[Risk]** Unknown-key stripping could make the compatibility behavior
  implicit. **Mitigation:** focused tests cover complete and malformed legacy
  values, redaction, omission from `Config`, and the quiet no-key path.
- **[Risk]** Existing automation invoking `memon notify` breaks immediately.
  **Mitigation:** this is an intentional breaking removal documented in the
  proposal; no replacement transport exists to which calls could be forwarded.
- **[Risk]** Old installed skills persist until synchronization. **Mitigation:**
  release notes instruct users to run the already-standard `memon
  install-skills`; the strict synchronizer removes stale names automatically.

## Migration Plan

1. Ship the Core, CLI, skills, and documentation changes together.
2. Existing services may start with a legacy `telegram:` block; they receive a
   warning and otherwise behave normally.
3. Operators remove the warned block and unset any `MEMON_TELEGRAM_*` variables.
4. Users run `memon install-skills` after upgrading, as documented for every
   release, which removes installed `memon-notify` copies.
5. Archive this OpenSpec change after review to update the main specifications
   and remove the active `telegram-notify` capability.

Rollback restores the command, Core helpers, configuration model, and bundled
skill together. A config whose legacy block was manually removed would need its
credentials restored before Telegram sends could work again; memon does not
retain or reconstruct them.
