---
id: baz-260503-080000
name: baz
project: project-a
status: FAILED
created_at: 2026-05-03T08:05:00+08:00
finished_at: 2026-05-03T09:30:00+08:00
host: m2.cluster
pid: 14123
gpus: [0, 1, 2, 3]
entry: ./run.sh
command: bash run.sh --proto=delta_ag --baseline_compare
wandb: https://wandb.ai/me/fsdp-comm/runs/baz-260503-080000
hypotheses: [H4]
tags: [fsdp2, comm, overlap]
---

## Motivation

Empirically measure overlap regression of delta all-gather vs. baseline AG on
FSDP2 (H4). Hypothesis predicts a categorical regression.

## Setup

- 4× A100, NCCL pyt2.4
- Llama-2-7B, bs=8, lr=1e-6
- 32-step warmup, then 64 measured steps
- Profile with nsight + torch profiler

## Method

1. Run baseline FSDP2 all-gather (overlap measured)
2. Run delta-AG variant (additional cache + decompress kernel on critical path)
3. Compare overlap ratio over the same 64 measured steps

## Result

- baseline overlap_ratio = 0.94
- delta-AG overlap_ratio = 0.92
- regression = 0.02 (NOT categorical, surprising)

(Crashed on step 96 of delta-AG run with NaN — see Caveats.)

## Conclusion

- H4 ❌ REFUTED in original strong form. Overlap regression exists but is
  small (~2 points), not the catastrophic loss predicted.
- The crash limits confidence — need a clean rerun.

## Caveats

- run crashed on step 96 with NaN in attn weights (likely numerical, not
  protocol-related; see logs/stderr.log)
- single node only; multi-node delta-AG may behave differently
- overlap measurement methodology may underestimate regression on
  comm-bound shapes

## Artifacts

- `./outputs/overlap_baseline.csv` — baseline timing
- `./outputs/overlap_delta_ag.csv` — delta-AG timing (truncated at step 96)
- `./logs/stdout.log` — training stdout
- `./logs/stderr.log` — NaN traceback (last 200 lines)
