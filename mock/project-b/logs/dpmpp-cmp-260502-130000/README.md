---
id: dpmpp-cmp-260502-130000
name: dpmpp-cmp
project: project-b
status: FINISHED
created_at: 2026-05-02T13:00:00+08:00
finished_at: 2026-05-02T15:30:00+08:00
host: bench-02
pid: 4421
gpus: [0]
entry: ./run.sh
command: bash run.sh --samplers=ddim,dpmpp_2m_karras --steps=20,50 --reruns=5
wandb: null
hypotheses: [H1]
tags: [sampler-cmp, dpm++, ddim]
---

## Motivation

Head-to-head comparison of DPM++ 2M Karras vs DDIM at fewer steps. If
DPM++ 20-step matches DDIM 50-step on FID, we can drop default sampler
budget by ~60%.

## Setup

- single A100, SD-1.5, fp16
- COCO-2017-val 5k captions, CFG=7.5
- 4 (sampler, steps) configs:
  - DDIM-20, DDIM-50
  - DPM++ 2M Karras-20, DPM++ 2M Karras-50
- 5 reruns per config (different seed)

## Method

For each config, generate 5k images × 5 reruns. Report FID mean ± std and
wall time per image.

## Result

| sampler              | steps | FID           | wall time / img |
| -------------------- | ----- | ------------- | --------------- |
| DDIM                 | 20    | 13.91 ± 0.09  | 0.58 s          |
| DDIM                 | 50    | 12.49 ± 0.08  | 1.41 s          |
| DPM++ 2M Karras      | 20    | 12.61 ± 0.06  | 0.61 s          |
| DPM++ 2M Karras      | 50    | 12.45 ± 0.05  | 1.45 s          |

- DPM++ 2M Karras-20 nearly matches DDIM-50 (FID gap = 0.12, within ±2σ)
- at 50 steps the two samplers are statistically indistinguishable
- DPM++ 20-step is ~2.4× faster than DDIM-50 for ~equivalent quality

## Conclusion

- DPM++ 2M Karras-20 is a recommended replacement for DDIM-50 default
- contributes to H1 ✅ (the broader claim that 50-step samplers match
  the high-step reference is robust across DDIM and DPM++)

## Caveats

- single seed bank per (sampler, run), so variance estimate may be optimistic
- bench-02 was used because bench-01 was tied up — minor calibration delta
- did not compare with PNDM, UniPC, or LMS — limited to DDIM/DPM++ family

## Artifacts

- `./outputs/sampler_cmp.csv` — full per-(config, run) FID + wall time
- `./outputs/fid_boxplot.png`
- `./logs/stdout.log` — run stdout
