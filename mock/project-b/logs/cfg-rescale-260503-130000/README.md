---
id: cfg-rescale-260503-130000
name: cfg-rescale
project: project-b
status: RUNNING
created_at: 2026-05-03T13:05:00+08:00
finished_at: null
host: bench-02
pid: 5012
gpus: [0]
entry: ./run.sh
command: bash run.sh --rescale_cfg --phi=0.7 --cfg=12 --reference_cfg=4.5 --prompts=parti1k
wandb: null
hypotheses: [H0004]
tags: [rescale-cfg, saturation, probe]
---

## Motivation

Initial probe of rescale-CFG (Lin et al. 2024) for H0004. Measure whether
phi=0.7 brings high-CFG (scale=12) outputs back into the saturation
envelope of low-CFG (scale=4.5) without losing prompt adherence.

## Setup

- single A100, SD-1.5, DDIM-50
- PartiPrompts-1k subset
- 3 settings: CFG=4.5 (control), CFG=12 (over-saturated baseline),
  CFG=12 + rescale phi=0.7 (treatment)
- 4 samples per prompt per setting

## Method

1. Generate the 3 sample sets (12k images total)
2. Saturation metric: V-channel mean of HSV (high V = saturated/bright)
3. Prompt adherence metric: CLIP-T similarity (CLIP-L/14, prompt vs image)
4. Diversity proxy: pairwise LPIPS over 4 samples per prompt

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

Full conclusion deferred until run completes.

## Conclusion

(Pending.)

## Caveats

- only one phi value tested in this probe (0.7); a phi sweep would
  characterize the trade-off curve
- HSV V-mean is one saturation proxy; perceptual saturation may differ
- single seed; need 2-3 reruns for noise estimate

## Artifacts

- `./outputs/live_metrics.csv` — append-only saturation/CLIP-T/LPIPS per prompt
- `./logs/stdout.log` — live run log
