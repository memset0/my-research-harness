# Spec Delta

## Purpose
Tickets run a registered Project only on the clusters it declares. memon keeps that Project's cluster checkout in sync, pulling when a ticket starts and pushing only the ticket's Run records when it ends, so syncing adds no Git conflicts.

## ADDED Requirements

### Requirement: Projects declare the clusters they may use
A central `config.yml` Project entry MAY declare `gpu_clusters`, a map from a cluster name (as used by the node registry's `cluster`) to `{root}`, where `root` is the absolute path of that Project's Git checkout on the cluster. Config loading SHALL reject a relative `root`, an empty map, or a cluster name with characters outside `[A-Za-z0-9._-]`. The declaration is a deployment fact and SHALL NOT be read from the Project's own repository.

#### Scenario: Invalid checkout path
- **WHEN** `config.yml` declares `gpu_clusters: {cluster-a: {root: work/project-a}}`
- **THEN** central refuses the configuration with an error naming the entry

### Requirement: Tickets are limited to the Project's clusters
A ticket request SHALL name a configured Project that declares `gpu_clusters`. Otherwise it SHALL be refused with `BAD_REQUEST` and SHALL NOT be stored. A ticket SHALL be granted only on nodes whose `cluster` is one of that Project's declared clusters. A ticket whose Project declares no cluster with registered nodes SHALL fail with a reason naming the Project.

#### Scenario: Project without clusters
- **WHEN** a ticket is requested for a configured Project with no `gpu_clusters`
- **THEN** the request is refused with `BAD_REQUEST` and nothing is stored

#### Scenario: Grant skips other clusters
- **GIVEN** `project-a` declares only `cluster-a`, and only a `cluster-b` node has free GPUs
- **WHEN** a ticket for `project-a` is planned
- **THEN** it stays `QUEUED` until a `cluster-a` node can hold it

### Requirement: Grant pulls the checkout before anything runs
When a ticket is granted, central SHALL run `git pull --no-rebase` in the Project's checkout on the granted node's cluster before starting the ticket's start command, and SHALL record a sync state on the ticket: `PULLING`, `READY` (with the resulting commit) or `PULL_FAILED` (with Git's output, truncated to 4 KiB). Execution requests SHALL be accepted in every sync state, so the holder can inspect and repair the checkout. On `PULL_FAILED` the start command SHALL NOT run. It SHALL stay stored, and `memon ticket show`, `memon ticket wait`, the ticket API and the dashboard SHALL report the failure. `memon ticket sync <id>` SHALL pull again and, on success, start a held command that has not started yet, exactly once. `--no-start` SHALL only pull.

#### Scenario: Pull fails, agent repairs and resumes
- **GIVEN** a ticket requested with start command `bash train.sh`, and a cluster checkout with a conflicting local edit
- **WHEN** the ticket is granted
- **THEN** its sync state is `PULL_FAILED` with Git's message and `train.sh` has not started
- **WHEN** the holder fixes the checkout through `memon ticket exec` and runs `memon ticket sync <id>`
- **THEN** the sync state becomes `READY` and `bash train.sh` starts as task `main` once

#### Scenario: Wait reports the failure
- **WHEN** the holder runs `memon ticket wait <id>` on a ticket whose pull failed
- **THEN** it returns at once with a non-zero exit and the sync failure in its output

### Requirement: Ticket end pushes only the ticket's Run records
When a ticket is released or expires, central SHALL first reclaim its tasks as it does today. It SHALL then, in the Project's cluster checkout, stage only Run directories whose `run.json` records `scheduler: {system: memon-ticket, job_id: <ticket id>}`, honoring `.gitignore`. If anything is staged it SHALL commit with a message naming the ticket and push, and SHALL NOT stage any other path. A rejected push SHALL be retried up to three times, each after `git pull --no-rebase`. The outcome (`PUSHED` with the commit, `NOTHING_TO_PUSH`, or `PUSH_FAILED` with Git's output) SHALL be recorded on the ticket and shown with it. For a Project whose `host` is central, central SHALL then fast-forward its own checkout and SHALL report, not force, a failed fast-forward.

#### Scenario: Other changes stay local
- **GIVEN** a ticket's checkout where Run `R1` records the ticket, Run `R2` records another ticket, and `src/model.py` was edited
- **WHEN** the ticket is released
- **THEN** the pushed commit contains only `R1`'s tracked files, and `R2` and `src/model.py` remain uncommitted

#### Scenario: Unreachable node at end
- **WHEN** a ticket expires while its node cannot be reached
- **THEN** the push is retried with the expiry reclaim, and the ticket reports `PUSH_FAILED` if the node stays unreachable

### Requirement: Runs inside a ticket record it
`memon run create` and `memon run update` SHALL set the Run's scheduler identity to `{system: memon-ticket, job_id: $MEMON_TICKET}` when `MEMON_TICKET` holds a ticket id and no `--job-id` is given.

#### Scenario: Run created in a ticket task
- **WHEN** `memon run create` runs inside a task of ticket `tk_7h3q9m2xw4ra`
- **THEN** the new `run.json` has `scheduler: {system: memon-ticket, job_id: tk_7h3q9m2xw4ra}`
