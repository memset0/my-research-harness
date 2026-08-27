# herdr-integration Specification

## Purpose
Provides an opt-in browser surface for a persistent Herdr workspace server,
using ttyd only as transport while Herdr owns workspace and process lifetime.

## Requirements

### Requirement: Herdr CLI integration is configured explicitly

The optional `terminal.herdr` block SHALL enable the Herdr integration and
SHALL contain `cli`, a non-empty array of non-empty argv elements. Memon SHALL
invoke this argv directly without shell interpolation. When the block is
absent, Herdr SHALL be disabled and no Herdr UI or process probe SHALL run.

#### Scenario: Configured absolute CLI entry

- **GIVEN** `terminal.herdr.cli` is `["/opt/herdr/bin/herdr"]`
- **WHEN** an owner starts Herdr from memon
- **THEN** memon invokes `/opt/herdr/bin/herdr` directly for both the TUI and workspace control commands

#### Scenario: Herdr block absent

- **GIVEN** `config.yml` has no `terminal.herdr` block
- **WHEN** the dashboard renders
- **THEN** no Herdr launcher or Open-with item is rendered
- **AND** no Herdr CLI or ttyd availability probe is caused solely by Herdr

### Requirement: Herdr TUI is available through ttyd in drawer and popup surfaces

An owner SHALL be able to open the configured Herdr TUI from the sidebar in the root terminal drawer, in the docked right split, and in a chrome-less popup. All surfaces SHALL attach to a single manager-deduplicated ttyd entry whose command is the configured Herdr CLI. Closing or switching any browser surface, ttyd idle eviction, memon shutdown, or tmux management actions SHALL NOT stop the Herdr server or its pane processes.

#### Scenario: Sidebar opens the Herdr drawer

- **GIVEN** Herdr is configured and ttyd is available
- **WHEN** an owner clicks `Open Herdr` in the sidebar
- **THEN** the root drawer opens a ttyd-backed Herdr TUI
- **AND** closing the drawer does not issue a Herdr stop command

#### Scenario: Herdr opens in the right split

- **GIVEN** Herdr is configured on a desktop viewport
- **WHEN** an owner moves the Herdr drawer to `Split right` or selects the Herdr target's split action
- **THEN** the dashboard remains visible on the left and the Herdr TUI fills the right terminal region

#### Scenario: Herdr opens in a popup

- **GIVEN** Herdr is configured
- **WHEN** an owner chooses the Herdr popup action
- **THEN** a same-origin `/terminal-popup?integration=herdr` window opens with the Herdr TUI filling its viewport

#### Scenario: All Herdr surfaces reuse one ttyd

- **GIVEN** any Herdr surface already has a healthy ttyd entry
- **WHEN** the owner switches to or opens another Herdr surface
- **THEN** the new browser client receives the same proxy URL and ttyd port
- **AND** no second Herdr client process is spawned

#### Scenario: Drawer and popup reuse one ttyd

- **GIVEN** the Herdr drawer already has a healthy ttyd entry
- **WHEN** the Herdr popup opens
- **THEN** both surfaces receive the same proxy URL and ttyd port
- **AND** no second Herdr client process is spawned

### Requirement: Open with Herdr creates or focuses a target workspace

The project, experiment, and run Open-with menus SHALL offer `Herdr` when the
integration is configured. Before displaying the TUI, memon SHALL list Herdr
workspaces and focus a workspace whose label equals the target display name;
if none exists, it SHALL create and focus a workspace at the resolved cwd. The
label SHALL be the project name for project scope, the experiment ID for
experiment scope, and the run ID for run scope. Project and experiment
workspaces SHALL start at the project root; run workspaces SHALL start at the
run directory, falling back using the existing terminal target rules.

#### Scenario: Project workspace is created

- **GIVEN** project `memon` has root `/srv/memon` and no Herdr workspace labelled `memon`
- **WHEN** the owner selects `Open with Herdr` at project scope
- **THEN** memon creates a focused Herdr workspace labelled `memon` with cwd `/srv/memon`
- **AND** opens the Herdr TUI through ttyd

#### Scenario: Experiment workspace is reused

- **GIVEN** Herdr already has workspace `w7` labelled `E0042-routing`
- **WHEN** the owner selects `Open with Herdr` for that experiment
- **THEN** memon focuses `w7` instead of creating another workspace
- **AND** the existing panes and processes in `w7` remain unchanged

#### Scenario: Concurrent create-or-focus is idempotent

- **GIVEN** no matching Herdr workspace exists
- **WHEN** two requests open the same target concurrently
- **THEN** memon serializes target setup so at most one workspace is created
- **AND** both requests attach to the shared Herdr ttyd entry

### Requirement: Herdr failures are bounded and actionable

Herdr control invocations SHALL have a bounded timeout and bounded output.
Malformed JSON, an unavailable CLI, a server-start race that does not recover,
or a non-zero CLI exit SHALL produce an owner-visible error and SHALL NOT fall
back to tmux or execute an interpolated shell command.

#### Scenario: Configured CLI is missing

- **GIVEN** `terminal.herdr.cli` points to a missing executable
- **WHEN** an owner opens Herdr
- **THEN** the start API returns a non-success response with an actionable error
- **AND** no tmux session is created

### Requirement: Herdr integration is Host-scoped in central mode
Herdr availability, workspace discovery, launch, attach, and terminal targets SHALL be advertised by and executed on the selected Host's Backend. Central SHALL not run a remote Host's Herdr command locally and SHALL include Host in all related targets and state.

#### Scenario: Herdr launch executes on owning Host
- **WHEN** the owner opens Herdr for a Project on Host A
- **THEN** Host A's Backend invokes its configured Herdr integration and central relays the resulting terminal only through Host A

### Requirement: Missing Herdr capability fails locally to the Host
A Host that is offline, incompatible, or advertises Herdr disabled SHALL not offer a Herdr launch action. This SHALL not disable Herdr on another usable Host.

#### Scenario: One Host lacks Herdr
- **WHEN** Host A advertises Herdr false and Host B advertises true
- **THEN** only Host B offers the integration and Host A receives no Herdr request
