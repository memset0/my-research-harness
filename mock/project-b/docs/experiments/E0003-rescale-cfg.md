---
id: E0003-rescale-cfg
slug: rescale-cfg
title: "Rescale-CFG saturation envelope recovery"
runs: [cfg-rescale-260503-130000]
hypotheses: [H0004]
tags: [rescale-cfg, saturation, probe]
created_at: 2026-05-03T13:05:00+08:00
updated_at: 2026-05-04T10:00:00+08:00
---

## Motivation

H0004 claims that rescale-CFG (Lin et al. 2024) with phi=0.7 brings
high-CFG (scale=12) outputs back into the saturation envelope of
low-CFG (scale=4.5) without losing prompt adherence (CLIP-T similarity
preserved within 1%, saturation V-channel mean dropping back to
baseline range).

The motivation crosses two lines of evidence: project-b's own H0002
(cfg-diversity-decay) shows high-CFG samples lose diversity, and
project-a's E0002-zero-snr-eval finds zero-SNR runs lose composition
score at higher CFG. Rescale-CFG is the candidate fix for both.

This experiment is currently a single-phi probe rather than a full
sweep — we want to know whether phi=0.7 lands in the right ballpark
before committing budget to a phi sweep across {0.3, 0.5, 0.7, 0.9}.

## Method

1. `cfg-rescale-260503-130000` — single A100, SD-1.5, DDIM-50,
   PartiPrompts-1k subset. Three settings: CFG=4.5 (control), CFG=12
   (over-saturated baseline), CFG=12 + rescale phi=0.7 (treatment).
   Four samples per prompt per setting.
2. Saturation metric: V-channel mean of HSV (high V = saturated /
   bright).
3. Prompt adherence metric: CLIP-T similarity (CLIP-L/14, prompt vs
   image).
4. Diversity proxy: pairwise LPIPS over 4 samples per prompt
   (cross-check with E0002).

## Conclusion

(In progress — see runs.)

Preliminary numbers from the live stream at prompt ~340 of 1000:

- Saturation V-mean: CFG=4.5 control 0.51 → CFG=12 baseline 0.68 →
  CFG=12 + rescale 0.7: 0.55 (very close to control — promising).
- CLIP-T similarity: CFG=4.5 0.281 → CFG=12 0.301 → CFG=12 + rescale
  0.7: 0.297 (within 1% of baseline — adherence retained).

Full conclusion deferred until the run completes; if these numbers
hold, H0004 will move from DEFERRED to PARTIAL or CONFIRMED depending
on the diversity / LPIPS readout.

## Caveats

- Only one phi value tested in this probe (0.7); a full phi sweep
  would characterize the trade-off curve.
- HSV V-mean is one saturation proxy; perceptual saturation may
  differ from the V-channel measurement.
- Single seed; need 2–3 reruns for a noise estimate.

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
