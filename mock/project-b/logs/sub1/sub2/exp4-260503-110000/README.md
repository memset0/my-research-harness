---
id: exp4-260503-110000
name: exp4
experiment: null
status: FINISHED
created_at: 2026-05-03T11:00:00+08:00
updated_at: 2026-05-03T11:00:00+08:00
finished_at: 2026-05-03T11:30:00+08:00
host: bench-01
pid: 9531
gpus: [0]
entry: ./run.sh
command: bash run.sh --workload=baseline --quick --samples=100
wandb: null
---

## Setup

- single A100, SD-1.5, DDIM-50, CFG=7.5
- 100 prompts (subset of sampler-equivalence-baseline set)

Orphan run fixture: lives at `logs/sub1/sub2/exp4-260503-110000/` to
demonstrate both the orphan-card UI (no `experiment:` binding) and
nested-discovery (the discovery layer recursing through `sub1/sub2/`
to find this run).

## Result

- mean wall time = 1.41s / image, p99 = 1.62s — within historical envelope
- FID not computed (sample count too small to be meaningful)

## Artifacts

- `./outputs/quick.csv` — per-prompt wall times
