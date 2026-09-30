---
id: sub-recipe-260504-110000
name: sub-recipe
status: FINISHED
created_at: 2026-05-04T11:00:00+08:00
updated_at: 2026-05-04T11:00:00+08:00
finished_at: 2026-05-04T12:30:00+08:00
host: gpu-node-09
pid: 99221
gpus: [0, 1]
archived: false
entry: ./train.sh
command: bash train.sh --recipe=image-generation --bs=64
wandb: null
---

## Setup

Fixture demonstrating an **orphan run** — a run dir under `logs/` that
has no `experiment:` binding, intended to surface the orphan-card UI
treatment in the dashboard. Lives at `logs/sub-recipe-260504-110000/`,
sibling to the `logs/sub/` nested grouping.

n/a — fixture only.

## Result

n/a — fixture only.

## Artifacts

(none)
