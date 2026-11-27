# GPU tickets

GPU work on the clusters memon manages runs through tickets from memon central.
Every `memon ticket` command talks to central only, so it works from any machine
with the memon CLI.

## Log in once

Ask the user for an API token (created in central's admin area: Access control →
API tokens), then run `memon login <central-url>` and paste it. On central itself
the stored owner credentials also work. A token acts as its account: a ticket
belongs to the account that requested it, and only that account can use it.

## Request and wait

```bash
memon ticket request --project <name> --whole-node --duration 6h --label "<what>" -- bash run.sh
memon ticket request --project <name> --gpus 2 --gpu-type H200 --duration 90m
memon ticket wait <id>
```

- Take the ticket id (`tk_…`) from the request's output. Never guess or reuse one.
- The command after `--` is optional. It starts as task `main` once the ticket is
  granted and the checkout is synced.
- `wait <id>` returns when the ticket is granted and synced. It exits 9 when the
  checkout pull failed (see below).
- Request only what you need, for as long as you need it. Release early.

## The cluster checkout

Each Project declares, in central's configuration, the clusters it may use and
its Git checkout on each. On grant, central pulls that checkout, or clones it
if it is missing. Treat the cluster checkout as code-read-only: change code
here, commit and push, and let the pull bring it over.

If the pull fails (for example, because of local edits on the cluster), the
start command is held. `memon ticket show <id>` prints Git's output under `sync`.
Fix the checkout with `memon ticket exec <id> -- …` (for example, inspect it with
`git status`, then stash or discard the edit), then run `memon ticket sync <id>`.
That pulls again and starts the held command once. Add `--no-start` to only pull.

## Use the GPUs

```bash
memon ticket exec <id> -- nvidia-smi -L        # short command (≤ 600 s); piped stdin is sent
memon ticket run <id> --name train -- bash train.sh
memon ticket ps <id>
memon ticket logs <id> train [--follow]
memon ticket wait <id> train                    # until it stops; prints its exit code
memon ticket kill <id> train
memon ticket attach <id> [train]                 # interactive; ctrl+\ detaches
memon ticket release <id>
```

Every command runs with `CUDA_VISIBLE_DEVICES` set to the granted GPUs. When the
ticket ends, its tasks and every process they started are stopped.

## Record each Run's resources

A ticket may serve zero, one or several Runs, and a Run may span several tickets
(for example, when it is resumed). You must record, on every Run that uses a
ticket, which cluster, node, GPUs and ticket it used. `memon run create` and
`memon run update` inside a ticket task (or `ticket exec`) append that entry to
`run.json` automatically:

```json
"resources": [{"ticket": "tk_…", "cluster": "…", "node": "…", "gpus": [0, 1]}]
```

`gpus` is omitted for a whole-node ticket, meaning every GPU of the node. If you
create or update a Run outside the ticket, add the entry yourself.

## What is pushed when the ticket ends

On release or expiry, central commits and pushes, in the cluster checkout, only
the Run directories whose `run.json` lists this ticket, honoring `.gitignore`.
Nothing else is committed: code edits on the cluster stay local, and so do Runs
of other tickets. Changed Run directories with no `resources` are reported as
unrecorded and are not pushed, so record them. `memon ticket show <id>` shows
the push result under `push`.

Untracked Run content (logs, checkpoints, raw outputs) stays on the cluster
where the Run executed. The Run's `resources` tell where to find it.
