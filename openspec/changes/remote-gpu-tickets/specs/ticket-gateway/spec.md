# Spec Delta

## Purpose
Ticket ownership and central-proxied, ticket-scoped execution let a holder use granted GPUs from any device through central's API, without direct access to node herdr cores.

## ADDED Requirements

### Requirement: Tickets belong to the account that requested them
A ticket SHALL record the account that requested it, and the dashboard and API SHALL show that username to callers who can see the ticket in full. Release, sync, and every execution request on a ticket SHALL be allowed only to that account. The super admin SHALL also be allowed when the request sets `force: true` (CLI `--force`), and such a forced action SHALL be recorded on the ticket. Any other caller SHALL receive `404` for tickets it does not own. Tickets created before ownership existed SHALL have no owner, and only the super admin SHALL act on them, with `force`.

#### Scenario: Another admin's ticket
- **GIVEN** admin `ada` holds ticket `tk_7h3q9m2xw4ra`
- **WHEN** admin `bob` releases it, or runs a command under it
- **THEN** each request answers `404` and the ticket is unchanged

#### Scenario: Super admin needs force
- **WHEN** the super admin releases ada's ticket without `force`, and then with `force`
- **THEN** the first request is refused with `409 OWNER_MISMATCH`, and the second releases it and records the forced release

### Requirement: Central executes ticket commands on the granted GPUs
Central SHALL expose, under `/api/gpu-pool/tickets/<id>/`, the operations that the ticket CLI performs: one-shot `exec` (command line, optional stdin and timeout up to 600 s; output streamed back, ending with the exit status), `tasks` start (`POST {name?, command}`) and list, task `logs`, `wait` and `kill`, and `attach` to a task or a new shell over a WebSocket. Every operation SHALL run on the ticket's node through central's herdr client, with the ticket's environment (`CUDA_VISIBLE_DEVICES`, `MEMON_TICKET`) and, on Slurm-held nodes, the ticket's own step. Each operation SHALL be refused with `409` unless the ticket is `GRANTED`. Task operations SHALL address only terminals labelled with that ticket. No route SHALL expose a raw herdr protocol connection, another ticket's terminals, or commands outside a ticket.

#### Scenario: Remote exec
- **GIVEN** ada's ticket is `GRANTED` on two GPUs
- **WHEN** ada runs `memon ticket exec <id> -- nvidia-smi -L` on her laptop
- **THEN** the output lists exactly the two granted GPUs and the CLI exits with the command's status

#### Scenario: Task names stay inside the ticket
- **WHEN** a caller asks for the logs of a task name that exists only under another ticket
- **THEN** the response is `404`

#### Scenario: Attach after release
- **WHEN** a WebSocket attach targets a ticket that has been `RELEASED`
- **THEN** the upgrade is refused with `409`

### Requirement: The ticket CLI talks only to central
Every `memon ticket` subcommand SHALL perform its work through central's API with the credentials resolved by `memon login`. It SHALL NOT need a local herdr client, SSH access to nodes, or the node registry. Exit codes SHALL keep their current meaning: a command's own status for `exec`, `NOT_FOUND` 4, `CONFLICT` 9, and `CENTRAL_UNAVAILABLE` for an unreachable central.

#### Scenario: CLI without local tooling
- **GIVEN** a machine with only the memon CLI and a stored login
- **WHEN** an agent requests a ticket, starts a task with `ticket run`, follows its `logs` and releases it
- **THEN** every step succeeds without any herdr or SSH binary on that machine
