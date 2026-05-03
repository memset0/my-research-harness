---
id: exp2-260502-090000
name: exp2
project: project-b
status: FINISHED
created_at: 2026-05-02T09:00:00+08:00
finished_at: 2026-05-02T17:00:00+08:00
host: bench-01
pid: 9012
gpus: [0]
entry: ./run.sh
command: bash run.sh --workload=cfg_sweep --cfg=4.5,7.5,10,12 --samples_per_prompt=4
wandb: null
hypotheses: [H2]
tags: [cfg-sweep, lpips, diversity]
---

## Motivation

Measure how sample diversity (pairwise LPIPS) decays with CFG scale (H2).

## Setup

- single A100, SD-1.5, DDIM-50 sampler
- 1k prompts (PartiPrompts-1k subset)
- 4 samples per prompt per CFG
- CFG ∈ {4.5, 7.5, 10, 12}
- different seed per (prompt, sample); same prompt set across CFG

## Method

For each prompt and CFG, compute pairwise LPIPS over the 4 samples
(C(4,2)=6 pairs), then average. Report mean and p99 across prompts.

## Result

| CFG | mean LPIPS | p99 LPIPS | drop vs CFG=4.5 |
| --- | ---------- | --------- | --------------- |
| 4.5 | 0.41       | 0.62      | —               |
| 7.5 | 0.38       | 0.59      | -7%             |
| 10  | 0.31       | 0.51      | -24%            |
| 12  | 0.26       | 0.43      | -37%            |

- non-linearity is clear past CFG=7.5
- p99 collapses faster than mean (tail of "stuck" prompts)

## Conclusion

H2 🟡 PARTIAL. The non-linear drop is real but only 4 CFG points sampled;
need to fill in {6, 8, 9, 11} to characterize the curve shape, and add
a non-LPIPS diversity metric (FID-coverage) to cross-check.

## Caveats

- only PartiPrompts-1k; LAION-art prompts may behave differently
- bench-01 has noisy NUMA peer — wall time numbers per-CFG not strictly
  comparable

## Artifacts

- `./outputs/cfg_4_5.csv` — per-prompt LPIPS at CFG=4.5
- `./outputs/cfg_7_5.csv`
- `./outputs/cfg_10.csv`
- `./outputs/cfg_12.csv`
- `./outputs/lpips_curve.png`
- `./logs/stdout.log` — run stdout
