---
id: cfg-rescale-260503-130000
name: cfg-rescale
experiment: E0003-rescale-cfg
status: RUNNING
created_at: 2026-05-03T13:05:00+08:00
updated_at: 2026-05-03T13:05:00+08:00
finished_at: null
host: bench-02
pid: 5012
gpus: [0]
archived: false
entry: ./run.sh
command: bash run.sh --rescale_cfg --phi=0.7 --cfg=12 --reference_cfg=4.5 --prompts=parti1k
wandb: null
---

## Setup

- single A100, SD-1.5, DDIM-50
- PartiPrompts-1k subset
- 3 settings: CFG=4.5 (control), CFG=12 (over-saturated baseline),
  CFG=12 + rescale phi=0.7 (treatment)
- 4 samples per prompt per setting

## Result

(In progress — currently at prompt ~340 of 1000.)

Preliminary numbers from the live stream:
- saturation V-mean:
  - CFG=4.5 control: 0.51
  - CFG=12 baseline: 0.68
  - CFG=12 + rescale 0.7: 0.55 (very close to control — promising)
- CLIP-T similarity:
  - CFG=4.5 control: 0.281
  - CFG=12 baseline: 0.301
  - CFG=12 + rescale 0.7: 0.297 (within 1% of baseline — adherence retained)

Full conclusion deferred until run completes (see parent experiment).

## Artifacts

- `./outputs/live_metrics.csv` — append-only saturation/CLIP-T/LPIPS per prompt
- `./logs/stdout.log` — live run log
