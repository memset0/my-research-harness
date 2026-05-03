---
id: bf16-conv-260503-093000
name: bf16-conv
project: project-a
status: RUNNING
created_at: 2026-05-03T09:45:00+08:00
finished_at: null
host: gpu-node-09
pid: 14512
gpus: [0, 1, 2, 3]
entry: ./train.sh
command: bash train.sh --param=v --formulation=flow_matching --dtype=bf16 --steps=50000
wandb: https://wandb.ai/me/imgflow/runs/bf16-conv-260503-093000
hypotheses: [H5]
tags: [diffusion, flow-matching, bf16, stability]
---

## Motivation

Test H5 — whether bf16 flow-matching loses convergence precision at low
noise levels (σ < 0.02), manifesting as oscillating val_loss with no
improvement past step ~10k.

## Setup

- 4× A100 80GB
- DiT-B/2, flow-matching formulation (v-target with rectified flow)
- bf16 mixed precision (master weights also bf16 — *not* fp32 master)
- bs=128, lr=2e-4, AdamW
- 50k-step run, val every 1k steps, per-σ-bucket loss logged
- concurrent fp32 control run scheduled separately (not yet started)

## Method

1. Train as usual; compute val_loss per σ bucket every 1k steps
2. Track val_loss oscillation: rolling std over the last 5k steps per bucket
3. Probe gradient magnitude in low-σ bucket: mean abs(grad) per layer

## Result

(In progress — currently at step ~6k of 50k.)

Preliminary observations from the live stream:
- val_loss in σ ∈ [0.5, 5.0] bucket: descending normally (0.094 → 0.071)
- val_loss in σ ∈ [0.002, 0.05] bucket: oscillating between 0.118 and 0.131
  with no clear trend (5k steps in)
- gradient magnitudes in low-σ bucket are within 2-3 ULP of bf16 round-off

Full conclusions deferred until step 50k.

## Conclusion

(Pending.)

## Caveats

- no fp32 control yet — observed oscillation could be optimizer noise
  rather than precision loss
- bf16 master weights is the strict test; fp32 master + bf16 compute is the
  more common config and would behave differently
- single seed; need 2-3 reruns for noise-vs-signal

## Artifacts

- `./outputs/val_loss_per_sigma_live.csv` — append-only per-bucket val loss
- `./outputs/grad_mag_per_layer.npz` — per-layer grad magnitude probes
- `./logs/stdout.log` — training stdout (live)
