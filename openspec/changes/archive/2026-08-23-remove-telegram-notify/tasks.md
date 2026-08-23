## 1. Core configuration compatibility

- [x] 1.1 Remove Telegram config types, schema fields, loaded-model fields, and
  public exports.
- [x] 1.2 Detect any raw top-level `telegram:` key, emit a static redacted
  removal warning to stderr, ignore its value, and keep configuration loading
  non-blocking.
- [x] 1.3 Replace Telegram config parsing tests with complete-block,
  malformed-block, redaction, omission, and quiet-no-key compatibility tests.

## 2. Notification implementation removal

- [x] 2.1 Remove Telegram rendering and notification-only auto-context modules,
  tests, and Core barrel exports.
- [x] 2.2 Remove the CLI notify handler, focused tests, imports, parser helpers,
  and top-level command registration.
- [x] 2.3 Verify CLI help no longer advertises `notify` and an invocation is
  rejected as an unknown command.

## 3. Bundled skills and documentation

- [x] 3.1 Delete the `memon-notify` skill and remove it from the exported skill
  inventory.
- [x] 3.2 Replace the code-review skill's notification step with an active
  conversation handoff containing the review path.
- [x] 3.3 Update the skills README, shared preflight, root README, and example
  configuration to remove Telegram setup, inventory, and special-case text.
- [x] 3.4 Confirm strict skill synchronization removes a stale installed
  `memon-notify` directory without changing the generic installer behavior.

## 4. Verification

- [x] 4.1 Run the skill validator for every remaining bundled skill (nine pass;
  `memon-migrate-fs` retains its intentional project-specific
  `disable-model-invocation` field, which the generic validator does not allow).
- [x] 4.2 Run focused Core config and CLI/install-skills tests plus affected
  package typechecks and builds.
- [x] 4.3 Audit non-archive implementation, skills, and documentation for
  unintended Telegram/notify residue; allow only the intentional legacy-config
  warning and this open change's migration text.
- [x] 4.4 Strictly validate the `remove-telegram-notify` OpenSpec change.
