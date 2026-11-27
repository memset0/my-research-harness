# Spec Delta

## Purpose
A registered Project's repository is kept in sync at the Project's own location and on every cluster it may use for GPUs. Tickets run the Project only on those clusters. Pulling when a ticket starts and pushing only Run records when it ends adds no Git conflicts, and raw Run outputs stay on the cluster where the Run executed.

## ADDED Requirements

### Requirement: Projects declare the clusters they may use
A central `config.yml` Project entry MAY declare `gpu_clusters`, a map from a cluster name (as used by the node registry's `cluster`) to `{root}`, where `root` is the absolute path of that Project's Git checkout on the cluster. Config loading SHALL reject a relative `root`, an empty map, or a cluster name with characters outside `[A-Za-z0-9._-]`. The declaration is a deployment fact and SHALL NOT be read from the Project's own repository.

#### Scenario: Invalid checkout path
- **WHEN** `config.yml` declares `gpu_clusters: {cluster-a: {root: work/project-a}}`
- **THEN** central refuses the configuration with an error naming the entry

### Requirement: The repository is synced at the Project and on its clusters
memon SHALL keep the Project's Git repository at its configured location and at every declared cluster checkout. When a checkout is needed and its `root` does not exist, central SHALL clone the Project's `origin` (as configured in the Project's own checkout) into `root` before using it. Tracked content (code, `run.json`, `result.csv`, processed `data/`) SHALL move between locations only through Git. Untracked Run content (logs, checkpoints, raw outputs) SHALL stay on the cluster where the Run executed, and memon SHALL NOT copy it elsewhere.

#### Scenario: First ticket on a new cluster
- **GIVEN** `project-a` declares `cluster-b` with a `root` that does not exist yet
- **WHEN** its first ticket is granted on a `cluster-b` node
- **THEN** central clones the repository into `root`, and the ticket proceeds as after a successful pull

#### Scenario: Raw outputs stay where they ran
- **GIVEN** a Run on `cluster-a` wrote `run.json`, `result.csv` and a 20 GB checkpoint under its directory
- **WHEN** its ticket ends and `cluster-b` later pulls
- **THEN** `cluster-b` and the Project's own location receive `run.json` and `result.csv` only

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
When a ticket is granted, central SHALL bring the Project's checkout on the granted node's cluster up to date with `git pull --no-rebase` (or the clone above) before starting the ticket's start command. It SHALL record a sync state on the ticket: `PULLING`, `READY` (with the resulting commit) or `PULL_FAILED` (with Git's output, truncated to 4 KiB). Execution requests SHALL be accepted in every sync state, so the holder can inspect and repair the checkout.

#### Scenario: Pull succeeds
- **WHEN** a ticket with start command `bash train.sh` is granted and the pull succeeds
- **THEN** its sync state is `READY` with the new commit, and `bash train.sh` runs as task `main`

### Requirement: A failed pull holds the start command for the holder
On `PULL_FAILED` the start command SHALL NOT run and SHALL stay stored. `memon ticket show`, `memon ticket wait`, the ticket API and the dashboard SHALL report the failure to the holder. `memon ticket sync <id>` SHALL pull again and, on success, start a held command that has not started yet, exactly once. `--no-start` SHALL only pull.

#### Scenario: Agent repairs and resumes
- **GIVEN** a ticket requested with start command `bash train.sh`, granted while its cluster checkout holds a conflicting local edit
- **WHEN** the holder inspects the failure, fixes the checkout through `memon ticket exec`, and runs `memon ticket sync <id>`
- **THEN** the sync state becomes `READY` and `bash train.sh` starts as task `main` once

#### Scenario: Wait reports the failure
- **WHEN** the holder runs `memon ticket wait <id>` on a ticket whose pull failed
- **THEN** it returns at once with a non-zero exit and the sync failure in its output

### Requirement: Runs record the clusters, resources and tickets they used
A ticket MAY serve zero or more Runs, and a Run MAY use several tickets (for example, when resumed). Every Run that uses ticket resources SHALL record each use in `run.json` as an entry of the optional list `resources: [{ticket, cluster, node, gpus?}]`. A ticket granted per GPU SHALL record `gpus`, the GPU indices on `node`. A ticket granted a whole node SHALL omit `gpus`, meaning every GPU of that node. Recording this is the Run author's obligation. `memon run create` and `memon run update` SHALL append the entry for the current ticket automatically when they run inside a ticket's environment (`MEMON_TICKET`, `MEMON_CLUSTER`, `MEMON_NODE`, `CUDA_VISIBLE_DEVICES`, and `MEMON_WHOLE_NODE=1` for whole-node tickets) and the Run has no entry for that ticket yet. Commands run under a ticket SHALL see those variables.

#### Scenario: Run created inside a ticket task
- **WHEN** `memon run create` runs inside a task of ticket `tk_7h3q9m2xw4ra` holding GPUs 0 and 1 of `node-01` in `cluster-a`
- **THEN** the new `run.json` has `resources: [{ticket: tk_7h3q9m2xw4ra, cluster: cluster-a, node: node-01, gpus: [0, 1]}]`

#### Scenario: Whole-node ticket
- **WHEN** `memon run create` runs inside a task of a whole-node ticket on `node-02`
- **THEN** the entry is `{ticket: <id>, cluster: <cluster>, node: node-02}` without `gpus`

#### Scenario: Resumed under a second ticket
- **WHEN** the same Run is updated inside a task of a later ticket
- **THEN** `resources` holds both entries, in order of use

### Requirement: Ticket end pushes only the ticket's Run records
When a ticket is released or expires, central SHALL first reclaim its tasks as it does today. It SHALL then, in the Project's cluster checkout, stage only Run directories whose `run.json` lists this ticket in `resources`, honoring `.gitignore`. If anything is staged it SHALL commit with a message naming the ticket and push, and SHALL NOT stage any other path. Changed Run directories that list no ticket SHALL be reported on the ticket as unrecorded and SHALL NOT be pushed. A rejected push SHALL be retried up to three times, each after `git pull --no-rebase`. The outcome (`PUSHED` with the commit, `NOTHING_TO_PUSH`, or `PUSH_FAILED` with Git's output) SHALL be recorded on the ticket and shown with it.

#### Scenario: Other changes stay local
- **GIVEN** a ticket's checkout where Run `R1` lists the ticket, Run `R2` lists another ticket, and `src/model.py` was edited
- **WHEN** the ticket is released
- **THEN** the pushed commit contains only `R1`'s tracked files, and `R2` and `src/model.py` remain uncommitted

#### Scenario: Run without a recorded ticket
- **GIVEN** a Run directory changed during the ticket whose `run.json` has no `resources`
- **WHEN** the ticket ends
- **THEN** that directory is not pushed and the ticket lists it as unrecorded

#### Scenario: Unreachable node at end
- **WHEN** a ticket expires while its node cannot be reached
- **THEN** the push is retried with the expiry reclaim, and the ticket reports `PUSH_FAILED` if the node stays unreachable

### Requirement: The Project's own location follows pushed Runs
After a successful push, central SHALL fast-forward the Project's own checkout when its `host` is central (`git pull --ff-only`). It SHALL record, and never force, a failed fast-forward. Other declared cluster checkouts SHALL pick the push up at their next pull.

#### Scenario: Central-hosted Project shows the Run
- **WHEN** a ticket of a `host: central` Project pushes Run `R1`
- **THEN** `R1` appears in central's checkout and on the dashboard without a manual pull
