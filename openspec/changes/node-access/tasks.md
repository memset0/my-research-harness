# Tasks

## 1. Node registry

- [x] 1.1 Add `yaml` as a direct `@memon/cli` dependency (same range as `@memon/core`) and verify `pnpm install --frozen-lockfile=false` updates only the lockfile entry for it
- [x] 1.2 Implement the registry loader/validator in `packages/cli/src/lib/nodes.ts` (path resolution, schema_version, node id pattern, exactly-one transport, optional fields, unknown-key rejection, offset-qualified `available_until`, expiry) and verify `lib/nodes.test.ts` covers every validation scenario in `specs/node-access/spec.md`
- [x] 1.3 Implement remote-line construction (`enter` wrapping with POSIX shell quoting) and transport argv building for `ssh` command/interactive and `via` command/shell modes, verified by unit tests asserting the exact argv from the spec scenarios

## 2. `memon ssh` command

- [x] 2.1 Register `memon ssh [node] [command...]` with `--list` in the tools program, classify it as `host` in `CLI_LEDGER_CLASSES`, and verify `command-surface.test.ts` includes `ssh`
- [x] 2.2 Implement command mode (inherited stdio, exit-status and `128+signal` passthrough), pre-spawn errors (`NOT_FOUND`, `NODE_EXPIRED` exit 13, `NODES_CONFIG_INVALID` exit 2), interactive-mode TTY and `shell` checks, and `--list` output without connection details; verify with `commands/ssh.test.ts` using a local `via: "sh -c"` node (quoting, exit 7 passthrough, expired, unknown, list redaction)
- [x] 2.3 Write `--help` text that documents the registry path, both transports, `enter`/`enter_tty`, expiry and exit-status passthrough with placeholder examples, and verify `memon ssh --help` prints it

## 3. Verification

- [x] 3.1 Run root `pnpm typecheck`, Biome on changed files, and the CLI test list (`lib/nodes.test.ts`, `commands/ssh.test.ts`, `command-surface.test.ts`, `lib/exit-codes.test.ts`) and record results
- [x] 3.2 Configure the operator's untracked registry with one SSH-plus-Slurm-step node and one via node, and verify `memon ssh <node> -- nvidia-smi …` succeeds on both and that `memon ssh --list` shows them unexpired
