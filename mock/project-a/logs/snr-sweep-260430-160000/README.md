---
id: snr-sweep-260430-160000
name: snr-sweep
project: project-a
status: FINISHED
created_at: 2026-04-30T16:05:00+08:00
finished_at: 2026-04-30T22:10:00+08:00
host: gpu-node-04
pid: 7821
gpus: [0, 1]
entry: ./train.sh
command: bash train.sh --param=eps --loss_weight=min_snr --gamma_sweep=1,3,5,7,10
wandb: https://wandb.ai/me/imgflow/runs/snr-sweep-260430-160000
hypotheses: [H0002]
tags: [diffusion, sweep, min-snr]
---

## Motivation

Establish a baseline sweep of min-SNR-γ before the v-pred run (foo) starts,
so we have an apples-to-apples ε-pred reference for H0002's loss-weighting
analysis (later refined in bar).

## Setup

- 2× A100 80GB
- DiT-S/2 (smaller than foo's DiT-B/2 to fit 5 runs in budget)
- bs=128, lr=2e-4, ε-prediction
- 30k steps per γ value, EDM noise schedule (NOT zero-SNR)
- shared seed across all 5 γ values
- γ ∈ {1, 3, 5, 7, 10}; γ=1 is unweighted baseline

## Method

1. Train 5 short runs back-to-back with only min-SNR γ varying
2. At step 30k, sample 2k images at CFG=7.5
3. Compute FID against COCO-2017-val and FFT high-band energy ratio
4. No checkpoint kept beyond step 30k (cost-controlled sweep)

## Result

| γ  | val_loss@30k | FID  | HF-band ratio |
| -- | ------------ | ---- | ------------- |
| 1  | 0.083        | 9.41 | 0.187         |
| 3  | 0.080        | 9.22 | 0.155         |
| 5  | 0.079        | 9.18 | 0.144         |
| 7  | 0.080        | 9.21 | 0.149         |
| 10 | 0.083        | 9.36 | 0.161         |

- best FID and HF-band ratio both at γ=5
- effect monotone within [1, 5], reverses past γ=7
- gap between γ=1 and γ=5 is roughly the same on DiT-S/2 as on DiT-B/2 later
  (cross-checked via bar-260502-150000)

## Conclusion

- min-SNR-γ=5 is the working default for subsequent runs (used by foo and
  baz)
- contributes to H0002 ✅ along with bar's analysis
- reinforces the sweet-spot interpretation: γ ∈ [3, 7] all beat unweighted

## Caveats

- DiT-S/2 (not DiT-B/2 used in foo/baz) — small-model results may not
  transfer at scale; bar specifically re-checks this on full-scale data
- ε-prediction only; no v-pred control in this sweep
- COCO-val FID at only 2k samples (noisy)

## Artifacts

- `./outputs/sweep_results.csv` — per-γ FID + HF-band table
- `./outputs/samples_gamma_5/` — 200 sample images at the best setting
- `./logs/stdout.log` — training stdout
