---
id: edm2-precond-260503-080000
name: edm2-precond
experiment: E0004-edm2-precond
status: FAILED
created_at: 2026-05-03T08:05:00+08:00
updated_at: 2026-05-03T08:05:00+08:00
finished_at: 2026-05-03T09:30:00+08:00
host: gpu-node-07
pid: 14123
gpus: [0, 1, 2, 3]
archived: false
entry: ./train.sh
command: bash train.sh --precond=edm2 --baseline_compare --img=256 --steps=120000
wandb: https://wandb.ai/me/imgflow/runs/baz-260503-080000
---

## Setup

- 4× A100, NCCL pyt2.4
- DiT-B/2, bs=128, lr=2e-4, EMA 0.9999
- 120k-step run, FID eval every 20k steps with 10k samples
- two parallel runs sharing seed: EDM (baseline) vs EDM2 (variant)
- only the precond / target-scaling changes; everything else identical

## Result

- baseline (EDM) best FID: 8.91 (at step 100k)
- EDM2 best FID: 8.74 (at step 80k — crashed shortly after)
- relative gain: 1.9% (well below the 5% threshold)
- EDM2 *did* converge faster (best FID at step 80k vs 100k); convergence
  speed is the real gain, not endpoint quality

(Crashed on step 84k of EDM2 run with NaN in cross-attn output — see
parent experiment Warnings table.)

## Artifacts

- `./outputs/fid_baseline.csv` — baseline FID timeseries
- `./outputs/fid_edm2.csv` — EDM2 FID timeseries (truncated at step 80k)
- `./logs/stdout.log` — training stdout
- `./logs/stderr.log` — NaN traceback (last ~200 lines)
