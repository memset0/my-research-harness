## Why

The browser terminal is currently coupled to tmux, so users who manage agent
processes in Herdr cannot open that persistent workspace from memon and must
keep tmux enabled even when they do not use it. Memon needs a peer Herdr
integration that reuses ttyd while leaving process ownership with Herdr.

## What Changes

- Add an opt-in Herdr terminal integration whose CLI entry point is configured
  in `config.yml` and is invoked without a shell.
- Let owners open the shared Herdr TUI in the root terminal drawer or a popup
  from the sidebar.
- Add `Open with Herdr` to project, experiment, and run Open-with menus. The
  action focuses an existing same-labelled Herdr workspace or creates and
  focuses one at the resolved target cwd before showing the TUI.
- Generalize the ttyd manager and drawer/popup surfaces so tmux and Herdr are
  peer backends while retaining the existing loopback proxy, authentication,
  LRU, idle-TTL, and ttyd installation behavior.
- Make the existing tmux integration independently configurable. It remains
  enabled by default for backward compatibility; when disabled, memon hides
  tmux UI, rejects tmux-only APIs before invoking tmux, and skips client probes
  and tmux-specific module work that are no longer needed.
- Keep all existing tmux commands, session naming, lifecycle, management, and
  defaults unchanged whenever tmux is enabled.

## Capabilities

### New Capabilities

- `herdr-integration`: configuration, Herdr workspace create-or-focus behavior,
  ttyd attachment, sidebar/drawer/popup surfaces, and Herdr-owned lifecycle.

### Modified Capabilities

- `browser-terminal`: makes ttyd transport backend-neutral, gates the existing
  tmux backend by config, and adds Herdr to the shared Open-with surface.
- `tmux-session-management`: makes tmux management optional and unavailable
  when the tmux integration is disabled.
- `web-layout`: adds the owner-only Herdr sidebar launcher and config-gates the
  existing Manage tmux footer item.
- `experiment-edit`: extends the unified Open-with picker with the enabled
  Herdr backend without changing its existing tmux agent choices.

## Impact

- Core config schema/types/loader and `config.example.yml` gain tmux enablement
  and Herdr CLI settings with backward-compatible defaults.
- Web runtime config, terminal APIs, ttyd process orchestration, proxy keys,
  root drawer, popup route, Open-with picker, and sidebar footer are extended.
- Tmux route/page guards and focused tests are added; existing tmux behavior
  remains covered by its current tests.
- Production configuration must explicitly enable Herdr and point at its CLI;
  no Herdr process is killed when ttyd is evicted, the drawer closes, or memon
  restarts.
