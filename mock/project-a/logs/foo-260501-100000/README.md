---
id: foo-260501-100000
name: foo
project: project-a
status: RUNNING
created_at: 2026-05-01T10:00:00+08:00
finished_at: null
host: gpu-node-07
pid: 12345
gpus: [0, 1, 2, 3]
entry: ./train.sh
command: bash train.sh --param=v --schedule=zero_snr --bs=128 --img=256
wandb: https://wandb.ai/me/imgflow/runs/foo-260501-100000
hypotheses: [H1, H3]
tags: [diffusion, v-pred, zero-snr, dump]
---

## Motivation

Replicate the v-prediction convergence advantage on our internal 256² image
dataset (H1) and quantify the brightness-vs-composition tradeoff of zero
terminal-SNR (H3) in the same training run.

## Setup

- 4× A100 80GB, single node
- DiT-B/2 backbone, AdaLN-zero conditioning
- bs=128, lr=2e-4, AdamW, EMA decay 0.9999
- v-prediction, EDM noise schedule with zero terminal-SNR
- 200k-step training run, eval every 5k steps
- text encoder frozen (CLIP-L/14)

## Method

1. Train two parallel runs with shared seed: v-pred and ε-pred (control)
2. Log per-bucket validation loss across σ ∈ [0.002, 80] in 8 log-spaced bins
3. Every 5k steps: sample 1k images at CFG=7.5, compute FID and brightness
   bias against COCO-2017-val
4. T2I-CompBench eval (color/shape/texture/spatial) at steps {25k, 50k, 100k, 200k}

## Result

(In progress — currently at step ~6k. Per-bucket val loss already showing
v-pred lead in σ<0.5 buckets; full analysis in follow-up bar-260502-150000.)

## Conclusion

(Pending — see bar-260502-150000 for the H1 / H2 analysis.)

## Caveats

- only one resolution (256²); 512² behavior may differ
- text encoder is frozen — joint-finetune behavior is out of scope
- preliminary numbers may shift as EMA warms up

## Artifacts

- `./checkpoints/` — DiT + EMA checkpoints (every 10k steps)
- `./outputs/val_loss_per_sigma.npz` — per-bucket val loss timeseries
- `./outputs/samples/` — 1k sampled images per eval step
- `./outputs/fid_brightness.csv` — FID + brightness bias per eval step
- `./logs/stdout.log` — training stdout (5k+ lines)
