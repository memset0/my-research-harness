---
id: snr-sweep-260430-160000
name: snr-sweep
experiment: E0003-snr-sweep
status: FINISHED
created_at: 2026-04-30T16:05:00+08:00
updated_at: 2026-04-30T16:05:00+08:00
finished_at: 2026-04-30T22:10:00+08:00
host: gpu-node-04
pid: 7821
gpus: [0, 1]
archived: false
entry: ./train.sh
command: bash train.sh --param=eps --loss_weight=min_snr --gamma_sweep=1,3,5,7,10
wandb: https://wandb.ai/me/imgflow/runs/snr-sweep-260430-160000
---

## Setup

- 2× A100 80GB
- DiT-S/2 (smaller than foo's DiT-B/2 to fit 5 runs in budget)
- bs=128, lr=2e-4, ε-prediction
- 30k steps per γ value, EDM noise schedule (NOT zero-SNR)
- shared seed across all 5 γ values
- γ ∈ {1, 3, 5, 7, 10}; γ=1 is unweighted baseline

## Result

| γ  | val_loss@30k | FID  | HF-band ratio |
| -- | ------------ | ---- | ------------- |
| 1  | 0.083        | 9.41 | 0.187         |
| 3  | 0.080        | 9.22 | 0.155         |
| 5  | 0.079        | 9.18 | 0.144         |
| 7  | 0.080        | 9.21 | 0.149         |
| 10 | 0.083        | 9.36 | 0.161         |

- best FID and HF-band ratio both at γ=5
- effect monotone within [1, 5], reverses past γ=7
- gap between γ=1 and γ=5 is roughly the same on DiT-S/2 as on DiT-B/2 later
  (cross-checked via bar-260502-150000)

## Artifacts

- `./outputs/sweep_results.csv` — per-γ FID + HF-band table
- `./outputs/samples_gamma_5/` — 200 sample images at the best setting
- `./logs/stdout.log` — training stdout
