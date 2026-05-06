---
id: E0001-sampler-equivalence
slug: sampler-equivalence
title: "Sampler equivalence at lower step budgets"
runs: [sampler-equivalence-baseline-260501-090000, sampler-equivalence-dpmpp-260502-130000]
hypotheses: [H0001]
tags: [sampler, ddim, dpmpp, fid]
created_at: 2026-05-01T09:00:00+08:00
updated_at: 2026-05-04T10:00:00+08:00
---

## Motivation

H0001 claims that DDIM at 50 sampling steps reaches the same FID as
DDPM at 1000 sampling steps on SD-1.5 (within ±0.1 FID), at the same
CFG scale. This is the methodology baseline we need before exploring
fewer-step samplers — without it we cannot calibrate the noise floor
of any subsequent FID comparison.

The experiment splits into two runs: the original
DDIM-50 vs DDPM-1000 baseline (`sampler-equivalence-baseline`) and a
DPM++ 2M Karras vs DDIM head-to-head at 20 and 50 steps
(`sampler-equivalence-dpmpp`). The second run extends the equivalence
claim from "DDIM-50 matches DDPM-1000" to "fewer-step modern samplers
also match the DDPM reference," which is the practical ask.

## Method

1. `sampler-equivalence-baseline-260501-090000` — single A100, SD-1.5
   (frozen weights), 10 reruns of DDIM-50 + 3 reruns of DDPM-1000 over
   COCO-2017-val 5k captions, CFG=7.5, fp16 inference. Shared seed
   across reruns within each sampler. Compute FID per sampler.
2. `sampler-equivalence-dpmpp-260502-130000` — single A100, SD-1.5,
   COCO-2017-val 5k captions, CFG=7.5. Four (sampler, steps) configs:
   DDIM-20, DDIM-50, DPM++ 2M Karras-20, DPM++ 2M Karras-50, with 5
   reruns per config (different seed). Report FID mean ± std and wall
   time per image.

## Conclusion

H0001 ✅ confirmed and extended.

From the baseline run:

- DDIM-50 FID: 12.48 ± 0.07 (10 reruns)
- DDPM-1000 FID: 12.51 ± 0.05 (3 reruns)
- difference well within reported variance
- DDIM-50 wall time: 1.4 s/image; DDPM-1000: 27.8 s/image
  (~20× slower for the same FID)

From the DPM++ comparison:

- DPM++ 2M Karras-20 FID = 12.61 ± 0.06 (nearly matches DDIM-50)
- DPM++ 2M Karras-50 FID = 12.45 ± 0.05 (statistically
  indistinguishable from DDIM-50 at 50 steps)
- DPM++ 20-step is ~2.4× faster than DDIM-50 at near-equivalent quality

Working baseline going forward: DDIM-50 (or DPM++ 2M Karras-20 if the
2.4× speedup matters). No need to rerun DDPM-1000 unless SD-1.5 itself
is updated.

## Caveats

- SD-1.5 only; SDXL has a different schedule and may need its own
  check.
- FID uses Inception-V3 weights; FD_DINOv2 might rank samplers
  differently.
- The DPM++ run was on bench-02 (bench-01 was tied up); minor
  calibration delta between the two benches is not factored out.
- We did not compare against PNDM, UniPC, or LMS — limited to the
  DDIM/DPM++ family.

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
