---
id: E0003-snr-sweep
slug: snr-sweep
title: "min-SNR-γ loss-weighting sweep"
runs: [snr-sweep-260430-160000]
hypotheses: [H0002]
tags: [diffusion, sweep, min-snr]
created_at: 2026-04-30T16:05:00+08:00
updated_at: 2026-05-04T10:00:00+08:00
---

## Motivation

Establish a baseline sweep of min-SNR-γ (H0002) before the v-pred run
(`foo`, in E0001) starts, so we have an apples-to-apples ε-pred
reference for the loss-weighting analysis. The sweep also serves as the
canonical reference checkpoint set used by E0002-zero-snr-eval (the γ=5
@ 30k checkpoint) and as a reusable artifact for future hyperparameter
work.

H0002 predicts a sweet-spot for γ in the [3, 7] range, with γ=5 as the
likely optimum based on the EDM2 paper's observations.

## Method

1. `snr-sweep-260430-160000` — 2× A100 sweep with DiT-S/2 (smaller than
   E0001's DiT-B/2 to fit five γ values within budget). bs=128, lr=2e-4,
   ε-prediction, 30k steps per γ value, EDM noise schedule (NOT
   zero-SNR), shared seed across γ values.
2. γ ∈ {1, 3, 5, 7, 10}; γ=1 is the unweighted baseline.
3. At step 30k, sample 2k images at CFG=7.5; compute FID against
   COCO-2017-val and FFT high-band energy ratio.
4. No checkpoint kept beyond step 30k (cost-controlled sweep).

## Conclusion

H0002 ✅ confirmed (with E0001's `bar` analysis as the cross-check on
DiT-B/2 scale). Best FID and HF-band ratio both at γ=5:

| γ | val_loss@30k | FID | HF-band ratio |
| - | - | - | - |
| 1 | 0.083 | 9.41 | 0.187 |
| 3 | 0.080 | 9.22 | 0.155 |
| 5 | 0.079 | 9.18 | 0.144 |
| 7 | 0.080 | 9.21 | 0.149 |
| 10 | 0.083 | 9.36 | 0.161 |

Effect is monotone within [1, 5] and reverses past γ=7 (over-smoothing
shows up as low-band energy shifting up). Gap between γ=1 and γ=5 on
DiT-S/2 is roughly the same as on DiT-B/2 (cross-checked via
E0001's `bar` analysis), so the choice of γ=5 transfers to full-scale
training.

Working default for subsequent runs: min-SNR-γ=5.

## Caveats

- DiT-S/2 was used (not DiT-B/2 from E0001's foo / baz); small-model
  results may not transfer at scale, though E0001's bar specifically
  re-checks this on full-scale data.
- ε-prediction only; no v-pred control inside this sweep.
- COCO-val FID at only 2k samples is noisy.

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
