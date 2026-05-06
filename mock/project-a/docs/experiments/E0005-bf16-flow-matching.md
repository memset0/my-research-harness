---
id: E0005-bf16-flow-matching
slug: bf16-flow-matching
title: "bf16 flow-matching low-σ stability"
runs: [bf16-flow-matching-260503-093000]
hypotheses: [H0005]
tags: [diffusion, flow-matching, bf16]
created_at: 2026-05-03T09:45:00+08:00
updated_at: 2026-05-04T10:00:00+08:00
---

## Motivation

H0005 predicts that bf16 flow-matching training loses convergence
precision at low noise levels (σ < 0.02), manifesting as oscillating
val_loss with no improvement past step ~10k. The numerical argument is
that bf16's ULP near zero is comparable to the gradient magnitudes in
the low-σ bucket of the flow-matching v-target, so the optimizer signal
is at the noise floor.

The experiment trains a single 50k-step flow-matching run with bf16
master weights (the strict-test config) and probes per-σ-bucket val
loss oscillation and per-layer gradient magnitudes. A concurrent fp32
control run is scheduled separately and is not part of this experiment
yet.

## Method

1. `bf16-flow-matching-260503-093000` — 4× A100 run, DiT-B/2,
   flow-matching formulation (v-target with rectified flow), bf16 mixed
   precision with bf16 master weights (NOT fp32 master). bs=128,
   lr=2e-4, AdamW.
2. 50k-step run, val every 1k steps, per-σ-bucket loss logged.
3. Track val_loss oscillation as rolling std over the last 5k steps per
   bucket.
4. Probe gradient magnitude in the low-σ bucket: mean abs(grad) per
   layer, written to `grad_mag_per_layer.npz`.

## Conclusion

(In progress — see runs.)

Preliminary observations from the live stream at step ~6k of 50k:

- σ ∈ [0.5, 5.0] bucket: val_loss descending normally
  (0.094 → 0.071).
- σ ∈ [0.002, 0.05] bucket: val_loss oscillating between 0.118 and
  0.131 with no clear trend.
- Gradient magnitudes in the low-σ bucket are within 2–3 ULP of bf16
  round-off, consistent with the noise-floor hypothesis.

Full conclusions deferred until step 50k.

## Caveats

- No fp32 control yet — the observed oscillation could be optimizer
  noise rather than precision loss; the concurrent fp32 control run is
  the canonical disambiguation and has not started yet.
- bf16 master weights is the strict test; fp32 master + bf16 compute is
  the more common production config and would behave differently
  (probably stably).
- Single seed; need 2–3 reruns for noise-vs-signal.

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
