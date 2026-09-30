---
id: foo-260501-100000
name: foo
status: RUNNING
created_at: 2026-05-01T10:00:00+08:00
updated_at: 2026-05-01T10:00:00+08:00
finished_at: null
host: gpu-node-07
pid: 12345
gpus: [0, 1, 2, 3]
archived: false
entry: ./train.sh
command: bash train.sh --param=v --schedule=zero_snr --bs=128 --img=256
wandb: https://wandb.ai/me/imgflow/runs/foo-260501-100000
---

## Setup

- 4× A100 80GB, single node
- DiT-B/2 backbone, AdaLN-zero conditioning
- bs=128, lr=2e-4, AdamW, EMA decay 0.9999
- v-prediction, EDM noise schedule with zero terminal-SNR
- 200k-step training run, eval every 5k steps
- text encoder frozen (CLIP-L/14)

## Result

(In progress — currently at step ~6k. Per-bucket val loss already showing
v-pred lead in σ<0.5 buckets; full analysis in follow-up bar-260502-150000.)

## Artifacts

- `./checkpoints/` — DiT + EMA checkpoints (every 10k steps)
- `./outputs/val_loss_per_sigma.npz` — per-bucket val loss timeseries
- `./outputs/samples/` — 1k sampled images per eval step
- `./outputs/fid_brightness.csv` — FID + brightness bias per eval step
- `./logs/stdout.log` — training stdout (5k+ lines)
