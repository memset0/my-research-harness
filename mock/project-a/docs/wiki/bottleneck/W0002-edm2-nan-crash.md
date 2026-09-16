---
id: W0002
kind: bottleneck
title: EDM2 run NaN crash at step 84k blocks the 256² comparison
description: "A stalled infrastructure incident: the EDM2 thread of E0004 diverged at step 84k with NaN activations in cross-attention, leaving only one valid endpoint FID for the H0004 verdict and blocking the clean 256² EDM2-vs-EDM comparison until the patched rerun finishes."
status: OPEN
sources: [E0004, edm2-precond-260503-080000, edm2-precond-rerun-260503-100000]
tags: [edm2, infra]
created_at: "2026-05-03T09:00:00+08:00"
updated_at: "2026-05-04T10:30:00+08:00"
---

# EDM2 run NaN crash at step 84k blocks the 256² comparison

> [!IMPORTANT] Blocks @H0004 until the rerun (@edm2-precond-rerun-260503-100000) finishes.

## Problem

The EDM2 thread of @E0004 (run @edm2-precond-260503-080000, DiT-B/2, bs=128, lr=2e-4, 120k step budget on 4× A100) emitted NaN values in the cross-attention output at step 84k and was killed by the launcher before reaching the planned 120k-step endpoint. The crash appeared suddenly with no preceding loss spike in the val_loss trace and coincided with one of the EDM2 thread's σ-bucket transitions, so the trigger is consistent with a bf16 underflow in the EDM2 preconditioner's high-curvature region rather than a preconditioning-concept bug. The original strong-form @H0004 prediction (≥5% FID gain over Karras-EDM at 256²) was already trending toward refutation at the crash point, but the NaN means the EDM2 endpoint FID (8.74) is computed from the last good checkpoint rather than a fully converged run.

## Impact

The crash leaves @E0004 with a single confirmed FID number for the EDM2 thread instead of the paired endpoint-vs-endpoint comparison the experiment was designed to produce; the reported 1.9% gain over the EDM baseline (8.74 vs 8.91) is therefore held at moderate confidence and the convergence-speed observation (best FID at step 80k vs 100k, ~20% fewer steps) cannot be cleanly separated from the early-termination confound. The downstream 256² EDM2-vs-EDM comparison table for @H0004 is blocked until @edm2-precond-rerun-260503-100000 — the same configuration with a NaN-skip patch and tightened grad-clipping at 0.5 — finishes its full 120k steps and produces an unconfounded EDM2 endpoint. No other hypothesis is directly gated by @E0004, but any future EDM2 preconditioning work inherits this crash signature as a known failure mode.

## Status

```yaml datatable@1 #run_status
title: EDM2 run status
columns: [run, status]
data:
  - [edm2-precond-260503-080000, FAILED]
  - [edm2-precond-rerun-260503-100000, PENDING]
```

The original run is marked CRASHED in the run index and the warning `w_2026-05-03T08-32-00+0800_a3f1` is OPEN, classifying the NaN as an infra/numerical incident rather than a preconditioning-design fault. @H0004 carries an ❌ REFUTED tag based on the partial EDM2 endpoint, with the explicit caveat that the verdict is provisional until the rerun removes the early-termination confound; @H0003 and the SNR-weighted @H0002 results are unaffected. The rerun @edm2-precond-rerun-260503-100000 is currently PENDING on the same 4× A100 allocation and is the highest-priority item in the @E0004 queue.

## Candidates

Three mitigation paths are on the table for the rerun, listed in order of expected effort-to-payoff: (1) keep the EDM2 defaults and only apply the NaN-skip patch plus the grad-clip 1.0 → 0.5 tightening, which is what @edm2-precond-rerun-260503-100000 is already configured to do and is the cheapest option; (2) switch the cross-attention QK-path to fp32 accumulation while leaving the rest of the network in bf16, matching what the EDM2 reference implementation does for 256²+ training; (3) adopt the EDM2 paper's recommended small preconditioning-hyperparameter grid rather than the single default set, which would convert @E0004 from a one-shot refutation into a sweep and address the "only one preconditioning hyperparameter set tested" caveat from the experiment page in the same pass.
