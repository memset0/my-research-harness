# Proposal

## Why

Research agents need to run commands on GPU nodes spread over clusters that are reached in very different ways: plain SSH, SSH through a login node with a Slurm step to enter a held allocation, or an owner-provided command (for example an HTTPS relay client) when compute nodes refuse inbound SSH. Today every agent hand-builds these command lines, so connection details leak into prompts and scripts and nothing records which node is usable until when. memon should own one uniform entry point; GPU tickets and scheduling build on it later.

## What Changes

- **Machine-local node registry.** A central-side, never-tracked YAML file (default `~/.config/memon/nodes.yml`, overridable with `MEMON_NODES_CONFIG`) lists each node with its cluster label, optional GPU count/type, a mandatory timezone-qualified `available_until`, and exactly one way to reach it. Every node is configured on its own; there is no inheritance between nodes of one cluster.
- **Two transports with one contract.** `ssh` (memon builds a non-interactive, batch-mode OpenSSH invocation from a target and extra options) and `via` (an owner-written shell command line that receives the remote shell line as its last argument and passes bytes through, the usual "use this command instead of ssh" contract). An optional `enter` argv prefix (for example a Slurm `srun --jobid … --overlap` step) wraps the remote line for either transport, so held Slurm allocations are reachable without memon talking to Slurm.
- **`memon ssh <node> [-- <command…>]`.** With a command, it runs it on the node, streams stdio and exits with the remote command's exit status. Without a command, it opens an interactive shell (an SSH TTY, or the node's optional `shell` command for `via` nodes). `memon ssh --list` reports configured nodes and whether they are expired. Unknown, expired and misconfigured nodes fail before anything is spawned, with structured errors.
- **Expiry is enforced.** A node past its `available_until` is refused; timestamps without an explicit offset are rejected at load time.
- Not in this change: GPU tickets and allocation, port forwarding, Web UI, central-hosted projects, and any change to `run-scheduler`.

## Capabilities

### New Capabilities
- `node-access`: the machine-local node registry, its validation and expiry rules, the `ssh`/`via`/`enter` transport contract, and the `memon ssh` command behavior.

### Modified Capabilities
- `memon-cli`: the stable exit-code dictionary gains the documented exception that `memon ssh` passes through the remote command's exit status after its own checks succeed.

## Impact

- **CLI** (`packages/cli`): new `ssh` command, node registry loader/validator, command-surface and ledger classification updates, `yaml` dependency.
- **Release:** distributed CLI artifact changes → MINOR bump; no filesystem convention change, no central Web change, no skills change.
- **Deployment data:** real node entries live only in the operator's local `nodes.yml` (plus any known-hosts file it references); tracked code, tests and docs use neutral placeholders.
