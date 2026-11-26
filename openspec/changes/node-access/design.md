# Design

## Context

See proposal.md for motivation. Constraints that shape the approach:

- Nodes are reached in heterogeneous ways. Some are plain SSH hosts. Some are compute nodes of a held Slurm allocation, entered from a login node with `srun --jobid <J> --overlap`; these may lack `/home`, so the step needs `--chdir`. Others refuse inbound SSH entirely and are reached only through an owner-maintained command, for example a relay client run as another local user. That command can be non-streaming, with stdin delivered at EOF and a bounded runtime.
- Connection facts (hosts, users, job ids, helper paths, expiry) are deployment data and must never enter Git (AGENTS.md §1.1).
- The CLI already has a stable error envelope and exit-code table, and a ledger class for every command path.

## Goals / Non-Goals

**Goals:**
- One command, `memon ssh`, that works the same way for every node, plus a list view safe to show an agent.
- Transport-agnostic: anything that can carry a shell line and bytes can be a node.
- Fail fast and loudly on misconfiguration and expiry.

**Non-Goals:**
- Tickets, allocation, GPU occupancy checks, port forwarding, a Web view, Slurm submission, managing known_hosts or credentials.

## Decisions

1. **Registry lives in its own machine-local YAML** (`~/.config/memon/nodes.yml`, `MEMON_NODES_CONFIG` override), not in central `config.yml` and not in project `.memon/project.yml`.
   - Nodes are shared across projects and contain connection details, so they belong on the operator's machine.
   - A separate file keeps the CLI independent of the Web config loader, and matches the `run-scheduler` change's machine-local `sched.yml` pattern.
   - Alternative rejected: a central `config.yml` section. The CLI would then need the Web's config resolution, and the file is edited by the settings panel.

2. **Two transports, one contract.**
   - `via` follows the common "replace ssh with a command" contract: an sh line that receives the remote shell line as its last argument. memon runs `/bin/sh -c '<via> "$1"' memon-via <line>`, so the line arrives as exactly one argument with no extra quoting layer.
   - `ssh` is kept as a first-class transport, not as a `via: ssh …`. memon can then enforce batch and host-key safety options and offer a real TTY for interactive sessions, which a generic via cannot.
   - Per-node configuration only. No cluster-level inheritance: node counts are small, and an explicit entry per node is easier to audit and edit.

3. **`enter` is transport-independent.** Wrapping as `<enter…> sh -c '<line>'` puts all shell syntax inside the entered context (for example inside the Slurm step), whatever the outer hop.
   - `enter_tty` exists because interactive Slurm steps need `--pty` while command mode must not allocate one.
   - Operators should include `-u` (unbuffered) in Slurm enter prefixes so output streams promptly.

4. **Exit status passthrough** like OpenSSH. memon's own errors are distinguishable because they always carry the structured stderr envelope and occur before any spawn. This is recorded as an explicit exception in the memon-cli exit-code requirement.

5. **Expiry check at invocation time** against `Date.now()`. `available_until` is parsed only when an explicit offset is present, validated by a strict regex before `Date.parse`, so a local-time value is never guessed.

6. **Ledger class `host`.** `memon ssh` is not project-scoped and must not file project receipts.

7. **YAML parsing** uses the `yaml` package already used by `@memon/core`, added as a direct CLI dependency at the same version range.

## Risks / Trade-offs

- [A via command that buffers stdin until EOF breaks interactive or streaming use] → Command mode still works for request/response commands. Interactive use needs a separate `shell` line. Streaming forwarders are out of scope.
- [Agents can still bypass memon and use raw credentials] → This change does not enforce access. Tickets and credential isolation are a follow-up change.
- [Exit-code passthrough collides with memon's own codes, e.g. a remote 4] → Callers distinguish them by the presence of the structured envelope. This is documented in the spec.
- [Operator puts real hostnames in tracked files] → All tracked examples and tests use placeholders. Real data goes only in the untracked registry.

## Migration Plan

- This is a new, additive command, and no existing behavior changes.
- Operators create `~/.config/memon/nodes.yml` by hand.
- Rollback: remove the file, or downgrade the CLI.
