---
id: cfg-diversity-decay-260502-090000
name: cfg-diversity-decay
experiment: E0002-cfg-diversity-decay
status: FINISHED
created_at: 2026-05-02T09:00:00+08:00
updated_at: 2026-05-02T09:00:00+08:00
finished_at: 2026-05-02T17:00:00+08:00
host: bench-01
pid: 9012
gpus: [0]
entry: ./run.sh
command: bash run.sh --workload=cfg_sweep --cfg=4.5,7.5,10,12 --samples_per_prompt=4
wandb: null
---

## Setup

- single A100, SD-1.5, DDIM-50 sampler
- 1k prompts (PartiPrompts-1k subset)
- 4 samples per prompt per CFG
- CFG ∈ {4.5, 7.5, 10, 12}
- different seed per (prompt, sample); same prompt set across CFG

## Result

| CFG | mean LPIPS | p99 LPIPS | drop vs CFG=4.5 |
| --- | ---------- | --------- | --------------- |
| 4.5 | 0.41       | 0.62      | —               |
| 7.5 | 0.38       | 0.59      | -7%             |
| 10  | 0.31       | 0.51      | -24%            |
| 12  | 0.26       | 0.43      | -37%            |

- non-linearity is clear past CFG=7.5
- p99 collapses faster than mean (tail of "stuck" prompts)

## Artifacts

- `./outputs/cfg_4_5.csv` — per-prompt LPIPS at CFG=4.5
- `./outputs/cfg_7_5.csv`
- `./outputs/cfg_10.csv`
- `./outputs/cfg_12.csv`
- `./outputs/lpips_curve.png`
- `./logs/stdout.log` — run stdout
