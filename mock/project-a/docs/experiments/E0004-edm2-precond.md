---
id: E0004-edm2-precond
slug: edm2-precond
title: "EDM2 vs Karras-EDM preconditioning"
runs: [edm2-precond-260503-080000, edm2-precond-rerun-260503-100000]
hypotheses: [H0004]
tags: [edm2, precond, fid]
created_at: 2026-05-03T08:05:00+08:00
updated_at: 2026-05-04T10:00:00+08:00
---

## Motivation

H0004 predicts that EDM2-style preconditioning (Karras et al. 2024)
yields ≥5% FID gain over the original Karras-EDM preconditioning at
256² ImageNet. The prediction is an extrapolation from the EDM2 paper's
64²/128² results; whether the gain holds at 256² has not been measured
on our DiT-B/2 stack.

The experiment runs an apples-to-apples baseline-vs-variant pair:
identical hyperparameters except for the preconditioning / target
scaling. Initial run (`edm2-precond`) crashed mid-run; a clean rerun
(`edm2-precond-rerun`) is queued to confirm the refutation result
without the NaN-crash confound.

## Method

1. `edm2-precond-260503-080000` — 4× A100 paired run. DiT-B/2, bs=128,
   lr=2e-4, EMA 0.9999, 120k steps. Two threads share a seed: EDM
   (baseline) vs EDM2 (variant). FID eval every 20k steps with 10k
   samples.
2. `edm2-precond-rerun-260503-100000` — clean rerun of the same
   configuration with NaN-skip patch and tighter grad clipping
   (0.5 instead of 1.0) to avoid the cross-attn NaN observed in the
   first run. Currently PENDING.
3. Compare best-EMA FID across the run; report endpoint quality and
   convergence speed (steps to best FID) separately.

## Conclusion

H0004 ❌ refuted in original strong form. EDM2 gives ~1.9% FID
improvement (8.74 vs 8.91), well below the 5% extrapolation predicted.

A secondary observation: EDM2 *did* converge faster (best FID at step
80k vs 100k for EDM baseline), which is ~20% fewer steps to best FID.
The convergence-speed advantage is real and worth a separate hypothesis
entry, but it is distinct from the endpoint-quality claim H0004 made.

Caveat: the original run crashed at step 84k of the EDM2 thread, so the
EDM2 endpoint number relies on extrapolation from the last good
checkpoint. The rerun is intended to remove this confound; until it
finishes, the refutation is held with moderate confidence.

## Caveats

- Original run crashed at step 84k of the EDM2 thread (NaN in cross-attn
  output, likely numerical rather than preconditioning-related — see
  `edm2-precond-260503-080000/logs/stderr.log`).
- Only one preconditioning hyperparameter set tested (EDM2 defaults);
  paper recommends a small grid which we did not sweep.
- 120k steps may be too short for either run to fully converge;
  extrapolation to the 1M-step regime is not warranted.
- The rerun is still pending at the time of writing this conclusion.

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
| OPEN | 2026-05-03T08:32:00+08:00 | edm2-precond-260503-080000 | infra | NaN crash at step 84k of EDM2 run; root cause likely unrelated to preconditioning |  |  | <!-- id:w_2026-05-03T08-32-00+0800_a3f1 -->
