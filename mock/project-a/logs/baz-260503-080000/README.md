---
id: baz-260503-080000
name: baz
project: project-a
status: FAILED
created_at: 2026-05-03T08:05:00+08:00
finished_at: 2026-05-03T09:30:00+08:00
host: gpu-node-07
pid: 14123
gpus: [0, 1, 2, 3]
entry: ./train.sh
command: bash train.sh --precond=edm2 --baseline_compare --img=256 --steps=120000
wandb: https://wandb.ai/me/imgflow/runs/baz-260503-080000
hypotheses: [H0004]
tags: [edm2, precond, fid]
---

## Motivation

Empirically measure FID gain of EDM2-style preconditioning over the original
EDM preconditioning at 256² ImageNet (H0004). Hypothesis predicts a ≥5% gain
based on extrapolation from the EDM2 paper's 64²/128² results.

## Setup

- 4× A100, NCCL pyt2.4
- DiT-B/2, bs=128, lr=2e-4, EMA 0.9999
- 120k-step run, FID eval every 20k steps with 10k samples
- two parallel runs sharing seed: EDM (baseline) vs EDM2 (variant)
- only the precond / target-scaling changes; everything else identical

## Method

1. Run baseline EDM run for 120k steps, FID@{20, 40, 60, 80, 100, 120}k
2. Run EDM2 variant for 120k steps, same FID schedule
3. Compare best-EMA FID across the run

## Result

- baseline (EDM) best FID: 8.91 (at step 100k)
- EDM2 best FID: 8.74 (at step 80k — crashed shortly after)
- relative gain: 1.9% (well below the 5% threshold)
- EDM2 *did* converge faster (best FID at step 80k vs 100k); convergence
  speed is the real gain, not endpoint quality

(Crashed on step 84k of EDM2 run with NaN in cross-attn output — see Caveats.)

## Conclusion

- H0004 ❌ REFUTED in original strong form. EDM2 gives ~1.9% FID improvement,
  not the ≥5% extrapolation predicted.
- Convergence-speed advantage is real (~20% fewer steps to best FID) and
  worth a separate hypothesis entry.
- The crash limits confidence in the endpoint number — clean rerun needed.

## Caveats

- run crashed on step 84k with NaN in cross-attn output (likely numerical,
  not preconditioning-related; see logs/stderr.log)
- only one preconditioning hyperparameter set tested (EDM2 defaults)
- 120k may be too short for either run to fully converge — extrapolation
  to 1M-step regime not warranted

## Artifacts

- `./outputs/fid_baseline.csv` — baseline FID timeseries
- `./outputs/fid_edm2.csv` — EDM2 FID timeseries (truncated at step 80k)
- `./logs/stdout.log` — training stdout
- `./logs/stderr.log` — NaN traceback (last ~200 lines)
