# Spec Delta

## Purpose

Broker GPUs of registered compute nodes centrally. Agents request GPUs, wait in a queue, use the granted GPUs freely through tickets, and get them reclaimed completely when the ticket ends.

## ADDED Requirements

### Requirement: Ticket requests are validated and queued
A request SHALL name a project and a duration (1 minute to 30 days). It SHALL name either a positive GPU count or a whole node, and MAY name a GPU type, a label (≤ 64 characters) and a start command. Invalid requests SHALL be refused with `BAD_REQUEST` and SHALL NOT be stored. A valid request SHALL be stored as `QUEUED` with an offset-qualified `requested_at` and a ticket id.

#### Scenario: Valid request queues
- **WHEN** an operator requests 2 GPUs for 6 hours for project `project-a`
- **THEN** a ticket with a fresh `tk_…` id is stored with status `QUEUED`

#### Scenario: Count and whole node together
- **WHEN** a request names both `gpus: 2` and `whole_node: true`
- **THEN** it is refused with `BAD_REQUEST` and nothing is stored

### Requirement: Ticket ids are random
A new ticket's id SHALL be `tk_` followed by 12 random lowercase Crockford base32 characters, so that no ticket id can be derived from another. Tickets stored before random ids SHALL keep their sequential `T<NNNN>` id, and a sequential id SHALL NOT resolve to a ticket that carries a random id. The CLI SHALL refuse an argument matching neither form with `BAD_REQUEST` before contacting central.

#### Scenario: Ids cannot be counted
- **GIVEN** a ticket `tk_7h3q9m2xw4ra` was just issued
- **WHEN** another caller asks for `T0002`, or for any id it did not receive
- **THEN** no ticket is found

#### Scenario: Malformed id
- **WHEN** `memon ticket show T1` runs
- **THEN** it exits with `BAD_REQUEST` without contacting central

### Requirement: Grants respect the registry and live GPU state
The broker SHALL consider queued tickets in `requested_at` order and grant every ticket that fits now. A GPU is grantable when all of these hold:
- its node is registered, unexpired and reachable through memon's herdr machine;
- the GPU is allocatable;
- the live snapshot shows it idle (no compute process, less than 1 GiB used);
- no granted ticket holds it;
- it is not dirty.
A node with `allocation: node` SHALL be granted only whole. The GPU type SHALL match case-insensitively. A ticket SHALL be granted only on a node whose `available_until` leaves at least the requested duration, and `expires_at` SHALL be `granted_at` plus the duration.

#### Scenario: Whole-node node refuses a partial grant
- **GIVEN** node `node-01` has `allocation: node` and 4 idle GPUs
- **WHEN** a ticket requests 2 GPUs
- **THEN** it stays `QUEUED` and is not granted on `node-01`

#### Scenario: Busy GPU is skipped
- **GIVEN** GPU 0 of a `gpus` node runs a compute process and GPUs 1–3 are idle
- **WHEN** a ticket requests 2 GPUs
- **THEN** the ticket is granted GPUs 1 and 2

#### Scenario: Node expiring too soon
- **GIVEN** the only matching node expires in 2 hours
- **WHEN** a ticket requests 6 hours
- **THEN** the ticket stays `QUEUED`

### Requirement: Unsatisfiable requests fail
A queued ticket that no registered node could ever satisfy, by GPU type, allocatable count or allocation mode, SHALL become `FAILED` with a reason, instead of waiting forever.

#### Scenario: Unknown GPU type
- **WHEN** a ticket requests GPU type `A100` and no registered node has that type
- **THEN** it becomes `FAILED` with a reason naming the type

### Requirement: Tasks run on the granted GPUs and are contained
Commands run under a ticket SHALL see `CUDA_VISIBLE_DEVICES` set to the granted GPU indices and `MEMON_TICKET` set to the ticket id. A long task SHALL run in a terminal of the node's herdr machine labelled `ticket=<id>`. On a node whose `enter` prefix holds a Slurm allocation, the task SHALL additionally run in its own `srun --overlap` step named `memon-task-<id>`. Tasks SHALL be refused unless the ticket is `GRANTED`.

#### Scenario: Start command at grant
- **GIVEN** a queued ticket with a start command
- **WHEN** it is granted
- **THEN** the command starts as task `main` in a labelled terminal, inside a `memon-task-<id>` step, with `CUDA_VISIBLE_DEVICES` set to the granted GPUs

#### Scenario: Task on a released ticket
- **WHEN** `memon ticket run tk_7h3q9m2xw4ra -- train.sh` targets a `RELEASED` ticket
- **THEN** the command exits 9 with `CONFLICT` and nothing starts

### Requirement: Release and expiry reclaim completely
On release, or when `expires_at` passes, the broker SHALL:
1. cancel every Slurm step named `memon-task-<id>`, using only step ids of the form `<job>.<step>` that belong to the node's hold job;
2. end and remove every terminal labelled `ticket=<id>`;
3. re-snapshot the granted GPUs.
GPUs that still run compute processes SHALL be marked dirty and withheld until a later snapshot shows them idle. The ticket SHALL end as `RELEASED` or `EXPIRED` respectively, with `ended_at`.

#### Scenario: Detached child is reclaimed
- **GIVEN** a granted ticket whose task started a `setsid` background process in its step
- **WHEN** the ticket is released
- **THEN** no process of that task remains, and the GPUs are grantable again

#### Scenario: Hold job is never cancelled
- **WHEN** a step listing yields an id that is not `<hold>.<number>`
- **THEN** the broker skips it and never cancels a bare job id

### Requirement: Unticketed GPU use is reported
The broker SHALL report compute processes found on allocatable GPUs that no granted ticket holds, with node, GPU and observation time. It SHALL NOT kill them.

#### Scenario: Process outside tickets
- **WHEN** a snapshot shows a compute process on an allocatable GPU that no ticket holds
- **THEN** the pool status lists it as unticketed use, and the GPU is not granted while busy

### Requirement: Ticket API is gated to cluster users
The ticket routes under `/api/gpu-pool/tickets` SHALL be reachable only by identities holding `access_clusters` (admins and the super admin, including owner Basic auth). They SHALL list, show, request and release tickets and expose the launch details the CLI needs. Viewers, users, guests and anonymous requests SHALL be denied.

#### Scenario: Viewer denied
- **WHEN** a share viewer requests `GET /api/gpu-pool/tickets`
- **THEN** the request is denied and no ticket data is returned

### Requirement: `memon ticket` command family
The CLI SHALL provide `memon ticket request|list|show|release` against central, and `exec|run|ps|logs|wait|kill|attach` against the ticket's node. Domain failures SHALL use the structured error envelope: unknown ticket exits 4, wrong state exits 9, bad input exits 2. `exec` SHALL pass the remote exit status through like `memon ssh`.

#### Scenario: Unknown ticket
- **WHEN** the user runs `memon ticket show T9999`
- **THEN** the command exits 4 with `NOT_FOUND`

### Requirement: Tickets appear on the cluster dashboard
The cluster overview SHALL list queued and granted tickets, plus tickets that ended within the last 24 hours, with id, Project, label, status, node, GPUs, request/grant/expiry times and the ticket's tasks. Each granted ticket SHALL draw a bar on the lanes of its GPUs from `granted_at` to `expires_at`, with the elapsed part distinguished. Ended tickets SHALL be collapsed by default.

#### Scenario: Granted ticket on the timeline
- **GIVEN** ticket `tk_7h3q9m2xw4ra` holds GPUs 0–3 of `node-01` and was granted 10 minutes ago for 1 hour
- **WHEN** the super admin opens the cluster overview
- **THEN** each of the four GPU lanes shows a bar for that ticket whose first sixth is shaded as elapsed, and the Tasks tab lists it as `GRANTED` with its tasks

### Requirement: Ticket details are limited to the viewer's Projects
The super admin (including owner Basic auth) SHALL see every ticket in full. An admin SHALL see full details only for tickets on Projects granted to them. Other granted tickets SHALL appear only as anonymous occupied bars, with no id, Project, label, reason or tasks; other queued or ended tickets SHALL not appear. Users, guests and viewers SHALL get no ticket data.

#### Scenario: Admin sees another project's ticket anonymously
- **GIVEN** an admin granted only `project-a`, and a granted ticket for `project-b` labelled `secret`
- **WHEN** the admin opens the cluster overview
- **THEN** the `project-b` ticket appears only as an occupied bar, and the response contains neither `project-b` nor `secret`

### Requirement: Ticket store files are owner-only
The ticket store and its write-ahead and shared-memory files SHALL be created with mode `0600`.

#### Scenario: New store
- **WHEN** the broker opens a new ticket store
- **THEN** the database file and any `-wal`/`-shm` files have mode `0600`
