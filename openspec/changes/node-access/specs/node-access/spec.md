# Spec Delta

## Purpose

Give agents and operators one uniform, machine-local way to reach registered compute nodes, independent of whether a node is reached over SSH, through a login node and a Slurm step, or through an owner-provided stream command.

## ADDED Requirements

### Requirement: Node registry is a machine-local, untracked file
memon SHALL read node definitions from `MEMON_NODES_CONFIG` when set, otherwise from `~/.config/memon/nodes.yml`. The file SHALL be YAML with `schema_version: 1` and a `nodes` mapping keyed by node id (`[a-z0-9][a-z0-9._-]{0,63}`). memon SHALL NOT create, write or track this file; a missing file SHALL be reported as an empty registry.

#### Scenario: Override path
- **GIVEN** `MEMON_NODES_CONFIG=/tmp/n.yml` declares node `node-01`
- **WHEN** the user runs `memon ssh --list`
- **THEN** the output lists `node-01` and memon did not read `~/.config/memon/nodes.yml`

#### Scenario: Missing file
- **GIVEN** no registry file exists
- **WHEN** the user runs `memon ssh --list`
- **THEN** the command exits 0 with an empty node list

### Requirement: Each node declares exactly one transport
Every node SHALL declare exactly one of `ssh` (an object with a non-empty `target` and optional string array `options`) or `via` (a non-empty shell command line). A node MAY declare `cluster`, `gpus` (positive integer), `gpu_type`, `enter` and `enter_tty` (non-empty string arrays) and, for `via` nodes, `shell` (a shell command line). Unknown keys and invalid values SHALL make the whole registry invalid.

#### Scenario: Both transports declared
- **GIVEN** a node declares both `ssh` and `via`
- **WHEN** any `memon ssh` invocation loads the registry
- **THEN** it exits 2 with `{"error":{"code":"NODES_CONFIG_INVALID",…}}` naming the node, and nothing is spawned

#### Scenario: Unknown key
- **GIVEN** a node declares an unrecognized key `hostname`
- **WHEN** the registry is loaded
- **THEN** loading fails with `NODES_CONFIG_INVALID` naming the key

### Requirement: Nodes declare allocation granularity
A node MAY declare `allocation` as `node` (allocatable only as a whole) or `gpus` (individual GPUs; the default). A `gpus` node MAY declare `allocatable_gpus`, a non-empty list of distinct GPU indices that requires `gpus` and stays below it; without it every GPU is allocatable. A `node` node SHALL NOT declare `allocatable_gpus`. Violations SHALL make the registry invalid.

#### Scenario: Partial GPUs allocatable
- **GIVEN** a node declares `gpus: 8` and `allocatable_gpus: [5, 6, 7]`
- **WHEN** the registry is loaded
- **THEN** the node reports allocation `gpus` with allocatable GPUs 5, 6 and 7

#### Scenario: Whole-node allocation rejects a GPU subset
- **GIVEN** a node declares `allocation: node` and `allocatable_gpus: [0]`
- **WHEN** the registry is loaded
- **THEN** loading fails with `NODES_CONFIG_INVALID` naming the node

#### Scenario: Index out of range
- **GIVEN** a node declares `gpus: 4` and `allocatable_gpus: [4]`
- **WHEN** the registry is loaded
- **THEN** loading fails with `NODES_CONFIG_INVALID` stating the index range

### Requirement: Availability carries an explicit timezone
Every node SHALL declare `available_until` as an ISO 8601 date-time with seconds-or-minutes precision and an explicit offset (`Z` or `±HH:MM`). Values without an offset or date-only values SHALL make the registry invalid. Comparison SHALL use absolute time.

#### Scenario: Missing offset rejected
- **GIVEN** a node declares `available_until: 2026-12-20T09:00:00`
- **WHEN** the registry is loaded
- **THEN** loading fails with `NODES_CONFIG_INVALID` stating that an explicit offset is required

#### Scenario: Different offsets compare absolutely
- **GIVEN** a node declares `available_until: 2026-12-19T16:00:00-08:00` (that is, `2026-12-20T00:00:00Z`)
- **WHEN** the current time is `2026-12-19T23:30:00Z`
- **THEN** that node is treated as not yet expired, and at `2026-12-20T00:00:00Z` it is expired

### Requirement: Expired and unknown nodes are refused before spawning
`memon ssh <node>` SHALL fail without spawning any process when the node id is not registered (`NOT_FOUND`, exit 4) or when the current time is at or after its `available_until` (`NODE_EXPIRED`, exit 13). Expired nodes SHALL remain listed by `memon ssh --list` with `expired: true`.

#### Scenario: Expired node
- **GIVEN** node `node-01` has `available_until` in the past
- **WHEN** the user runs `memon ssh node-01 -- hostname`
- **THEN** the command exits 13 with error code `NODE_EXPIRED` and no transport process is started

#### Scenario: Unknown node
- **WHEN** the user runs `memon ssh missing -- hostname`
- **THEN** the command exits 4 with error code `NOT_FOUND`

### Requirement: Remote line construction
The words after `--` SHALL be joined with single spaces into one remote shell line, as OpenSSH does. When the node declares `enter`, the line sent SHALL be the shell-quoted `enter` words followed by `sh -c` and the shell-quoted original line, so shell syntax in the command runs entirely inside the entered context.

#### Scenario: Enter wraps the whole line
- **GIVEN** node `node-01` declares `enter: [srun, --jobid=42, --overlap]`
- **WHEN** the user runs `memon ssh node-01 -- 'cd /tmp && hostname'`
- **THEN** the remote line is `srun --jobid=42 --overlap sh -c 'cd /tmp && hostname'`

### Requirement: SSH transport runs a non-interactive batch OpenSSH command
For an `ssh` node running a command, memon SHALL invoke `ssh` with `-T` and the options `BatchMode=yes`, `ForwardAgent=no` and `StrictHostKeyChecking=yes`, followed by the node's `options` as `-o` values, the `target` and the remote line as a single final argument. memon SHALL NOT accept unknown host keys on the operator's behalf.

#### Scenario: Batch invocation
- **GIVEN** node `node-01` has `ssh: {target: user@login.example, options: [UserKnownHostsFile=/k]}`
- **WHEN** the user runs `memon ssh node-01 -- hostname`
- **THEN** memon spawns `ssh -T -o BatchMode=yes -o ForwardAgent=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/k user@login.example hostname`

### Requirement: Via transport appends the remote line as one argument
For a `via` node running a command, memon SHALL run the `via` line with `/bin/sh -c` and pass the remote line as exactly one additional final argument, unmodified. The via command is responsible for carrying bytes both ways; memon SHALL NOT interpret its output.

#### Scenario: Line with spaces and quotes arrives intact
- **GIVEN** node `local` declares `via: "sh -c"`
- **WHEN** the user runs `memon ssh local -- 'printf "%s|" "a  b"'`
- **THEN** stdout is `a  b|` and the command exits 0

### Requirement: Command mode streams stdio and passes through the exit status
In command mode memon SHALL inherit stdin, stdout and stderr to the transport process, add no output of its own on success, and exit with the transport's exit status; a transport terminated by a signal SHALL yield `128 + signal number`. memon's own failures (registry, unknown or expired node, transport not startable) SHALL use the structured stderr envelope.

#### Scenario: Remote failure code is preserved
- **GIVEN** a reachable node
- **WHEN** the user runs `memon ssh <node> -- 'exit 7'`
- **THEN** memon exits 7 and writes no error envelope

### Requirement: Interactive mode needs a terminal and a declared shell path
Without a command, `memon ssh <node>` SHALL open an interactive session only when stdin and stdout are terminals. For `ssh` nodes memon SHALL invoke `ssh -tt` with the same safety options, sending the shell-quoted `enter_tty` (falling back to `enter`) words followed by `bash -l` when either is declared, and no remote command otherwise. For `via` nodes memon SHALL run the node's `shell` line; a `via` node without `shell` SHALL be refused with `BAD_REQUEST`.

#### Scenario: Via node without shell
- **GIVEN** node `relay-node` declares `via` but no `shell`
- **WHEN** the user runs `memon ssh relay-node` in a terminal
- **THEN** memon exits 2 with `BAD_REQUEST` explaining that the node only supports `memon ssh relay-node -- <command>`

#### Scenario: No terminal
- **WHEN** `memon ssh node-01` runs with stdin redirected from a file
- **THEN** memon exits 2 with `BAD_REQUEST` asking for `-- <command>`

### Requirement: Listing reports registry state without secrets
`memon ssh --list` SHALL print JSON `{"nodes":[…]}` with, per node, `id`, `cluster`, `gpus`, `gpu_type`, `allocation`, `allocatable_gpus` (index list, or `null` when unknown because `gpus` is not declared), `available_until`, `expired`, `transport` (`ssh` or `via`) and `interactive` (whether an interactive session is possible), ordered by id. It SHALL NOT print via lines, SSH targets, options or enter prefixes.

#### Scenario: List omits connection details
- **GIVEN** a registry with one `ssh` node and one `via` node without `shell`
- **WHEN** the user runs `memon ssh --list`
- **THEN** both nodes appear with `transport` set, the `via` node has `interactive: false`, and the output contains neither the SSH target nor the via line
