---
id: bar-260502-150000
name: bar
project: project-a
status: FINISHED
created_at: 2026-05-02T15:05:00+08:00
finished_at: 2026-05-02T18:00:00+08:00
host: gpu-node-07
pid: 12892
gpus: [0]
entry: ./analyze.sh
command: bash analyze.sh --analyze=foo-260501-100000 --window=5000
wandb: null
hypotheses: [H1, H2]
tags: [analysis, fft, snr]
---

## Motivation

Analyze the per-step val loss + sample dump from foo-260501-100000 to test
H1 (v-pred convergence speed) and H2 (SNR-weighted loss reduces high-frequency
artifacts).

## Setup

- single GPU job (analysis only)
- input: foo-260501-100000/outputs/val_loss_per_sigma.npz + samples/
- noise buckets σ ∈ {0.002, 0.05, 0.5, 1.0, 5.0, 10, 20, 80}
- min-SNR-γ ∈ {1, 3, 5, 7, 10}

## Method

1. For H1: compare v-pred vs ε-pred val_loss curves per σ bucket; report
   step at which each crosses val_loss=0.072
2. For H2: re-weight the cached training-loss tensor with min-SNR-γ; train
   a tiny LoRA head with reweighted loss for 2k steps, sample 500 images,
   compute FFT high-band (>0.25 cycles/pixel) energy ratio against baseline

## Result

- v-pred reaches val_loss=0.072 at step 3500
- ε-pred reaches val_loss=0.072 at step 5100 (~31% slower; H1 ✅)
- per-bucket gap (steps to threshold):
  - σ ∈ [0.002, 0.5]: v-pred 35-40% faster
  - σ ∈ [0.5, 5.0]: v-pred 12-18% faster
  - σ > 5.0: within ±2% (no advantage)
- min-SNR-γ FFT high-band ratio:
  - baseline 0.184
  - γ=3: 0.151
  - γ=5: 0.139 (best — H2 ✅)
  - γ=7: 0.142
  - γ=10: 0.156 (over-smooth: low-band shifts up too)
- FID@256 with γ=5: 8.87 (vs baseline 8.92 — within noise)

## Conclusion

- H1 ✅ CONFIRMED — v-pred converges ~31% faster, advantage concentrated in
  low-noise buckets as predicted
- H2 ✅ CONFIRMED — min-SNR-γ=5 reduces HF artifacts by 24% with no FID cost
- Suggest defaulting future runs to v-pred + min-SNR-γ=5

## Caveats

- LoRA-head reweighting is a proxy for full training; full retrain may differ
- "high-frequency artifact" metric is FFT-band energy, not perceptual
- bs=32 control runs (not in this analysis) showed weaker H2 effect — small
  batch may not benefit

## Artifacts

- `./outputs/h1_curves.csv` — per-bucket val loss curves
- `./outputs/h2_fft_ratios.csv` — FFT band ratios per γ
- `./outputs/notes.md` — qualitative observations from sample inspection
- `./logs/stdout.log` — analysis stdout

## New Hypotheses

- **(candidate H7)** min-SNR-γ benefit collapses below batch size 64 — worth a
  separate hypothesis entry; suggests effective-batch tuning matters more than
  the loss-weighting form for small-batch training
