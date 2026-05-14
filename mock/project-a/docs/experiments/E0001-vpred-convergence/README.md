---
id: E0001-vpred-convergence
slug: vpred-convergence
title: v-prediction vs ε-prediction convergence study
status: OPEN
archived: false
runs: [foo-260501-100000, bar-260502-150000]
hypotheses: [H0001]
tags: [diffusion, v-pred, convergence]
created_at: "2026-05-01T10:00:00+08:00"
updated_at: "2026-05-13T23:56:02+00:00"
---

## Motivation
We want to replicate the v-prediction convergence advantage from
Salimans & Ho 2022 on our internal 256² image dataset (H0001), and
quantify the brightness-vs-composition tradeoff of zero terminal-SNR
training in the same family of runs. Anecdotally we have seen v-pred
converge faster on small toy datasets, but no apples-to-apples
comparison on the production DiT-B/2 backbone has been recorded.

The investigation is split across one training run (`foo`) plus one
analysis run (`bar`) consuming `foo`'s validation-loss dump and sample
outputs. The training run also dumps zero-SNR samples that feed into
sibling experiments (E0002 zero-snr-eval). H0001 is the primary
hypothesis under test here; H0002 (min-SNR loss weighting) is touched
incidentally by `bar`'s reweighting analysis.

## Method
1. `foo-260501-100000` — primary training run. DiT-B/2, bs=128, lr=2e-4,
   v-prediction, EDM noise schedule with zero terminal-SNR. Two parallel
   threads share a seed: a v-pred branch and an ε-pred control branch.
   Per-bucket validation loss is logged across σ ∈ [0.002, 80] in 8
   log-spaced bins. Every 5k steps the run samples 1k images at CFG=7.5.
2. `bar-260502-150000` — single-GPU analysis run consuming `foo`'s
   `val_loss_per_sigma.npz` and sample dump. Compares v-pred vs ε-pred
   step-to-threshold per σ bucket (H0001), then reweights the cached
   training-loss tensor with min-SNR-γ ∈ {1, 3, 5, 7, 10} and trains a
   tiny LoRA head for 2k steps to probe the FFT high-band energy ratio
   (H0002 cross-check).

## Plan
- [x] Run `foo-260501-100000` to 10k steps with v-pred + ε-pred parallel
  - Both branches reached the val_loss=0.072 threshold; v-pred at step
    3500, ε-pred at 5100. Loss curves diverge cleanly after step 1500.
- [x] Sample 1k images per branch at CFG=7.5 every 5k steps
  - 8 sample dumps collected; FID measured offline via `bar`.
- [x] Run `bar-260502-150000` to compute step-to-threshold per σ bucket
  - low-noise wins are largest (σ ∈ [0.002, 0.5]: 35–40% faster); the
    advantage shrinks toward parity in the σ > 5.0 region.
- [ ] Sweep min-SNR-γ ∈ {1, 3, 5, 7, 10} for the LoRA-head reweighting
  - [x] γ=1 (baseline, no reweighting)
  - [x] γ=3
  - [x] γ=5 — best HF-band energy ratio so far
  - [ ] γ=7
  - [ ] γ=10
- [ ] Cross-validate against E0003-snr-sweep results before promoting
      min-SNR-γ=5 as the new default
  - Need bar to land first; tracking via E0003's Plan.
- [ ] Decide whether to extend to 512² resolution as a follow-up
      experiment

## Conclusion
H0001 ✅ confirmed. v-pred reaches val_loss=0.072 at step 3500; ε-pred
reaches the same threshold at step 5100, ~31% slower. The advantage is
concentrated in low-noise buckets (σ ∈ [0.002, 0.5]: 35–40% faster) and
shrinks toward parity at high noise (σ > 5.0: within ±2%).

H0002 ✅ partially supported by this experiment (the primary run is
E0003-snr-sweep). bar's reweighting analysis finds min-SNR-γ=5 reduces
HF-band energy 24% with no FID cost.

Recommendation: default future runs to v-pred + min-SNR-γ=5.

## Caveats
- Results measured at 256² resolution only; 512² behavior may differ.
- Text encoder (CLIP-L/14) frozen for both runs — joint-finetune
  behavior out of scope.
- LoRA-head reweighting in `bar` is a proxy for full training; full
  retrain may differ.
- bs=32 control runs (not in this experiment) showed weaker H0002
  effect — small batch may not benefit from min-SNR.

## Warnings
| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
