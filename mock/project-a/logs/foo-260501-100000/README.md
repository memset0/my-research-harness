---
id: foo-260501-100000
name: foo
project: project-a
status: RUNNING
created_at: 2026-05-01T10:00:00+08:00
finished_at: null
host: m2.cluster
pid: 12345
gpus: [0, 1, 2, 3]
entry: ./run.sh
command: bash run.sh --batch=8 --layers=24 --dump=param_delta
wandb: https://wandb.ai/me/fsdp-comm/runs/foo-260501-100000
hypotheses: [H1, H3]
tags: [moe, fsdp2, dump]
---

## Motivation

Reproduce the prior-work observation that per-step bf16 param delta is highly
sparse (H1), and check whether top-k mask stability holds across many steps
(H3) or drifts.

## Setup

- 4× A100 80GB, single node
- Llama-2-7B base + LoRA-r=16 on alpaca-rl
- bs=8, lr=1e-6, bf16, FSDP2 sharding
- 160-step training run, dumping param + grad every step

## Method

1. Patch optimizer step to dump param tensors before/after each apply
2. Compute bit-level equality across step pairs (1-step, 8-step, 32-step, 160-step)
3. For grad top-k mask stability: track which 1024 positions are in the top-k
   each step, measure overlap with prior step's set

## Result

(In progress — partial results streaming to logs/, full analysis in
follow-up bar-260502-150000.)

## Conclusion

(Pending — see bar-260502-150000.)

## Caveats

- only one lr point (1e-6); generalization to RL-typical [5e-7, 1e-5] not yet
- deepfair was silently checkpointing — disabled mid-run

## Artifacts

- `./checkpoints/` — sharded fsdp2 checkpoints (step every 32)
- `./outputs/param_delta.npz` — per-step param delta tensors (bf16)
- `./outputs/grad_topk.json` — per-step top-k position sets
- `./logs/stdout.log` — training stdout (5k+ lines)
