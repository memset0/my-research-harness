# diffusion-prior hypotheses

## Status legend

| Symbol | Status | Meaning |
| :---: | --- | --- |
| ✅ | CONFIRMED | measured data supports |
| ❌ | REFUTED | measured data contradicts |
| 🟡 | PARTIAL | conditional / partial support |
| 🔵 | OPEN | proposed, not yet measured |
| ⚪ | DEFERRED | explicitly out of current scope |

## Summary table

| ID | Statement | Status | Experiments |
| :-: | --- | :-: | --- |
| H0001 | v-prediction loss converges faster than ε-prediction in the low-noise regime | ✅ | E0001-vpred-convergence |
| H0002 | SNR-weighted (min-SNR-γ) loss reduces high-frequency artifacts | ✅ | E0003-snr-sweep, E0001-vpred-convergence |
| H0003 | zero terminal-SNR schedule improves brightness fidelity but hurts compositional accuracy | 🟡 | E0001-vpred-convergence, E0002-zero-snr-eval |
| H0004 | EDM2-style preconditioning yields ≥5% FID gain over Karras-EDM at 256² | ❌ | E0004-edm2-precond |
| H0005 | bf16 flow matching loses convergence precision at σ < 0.02 | 🔵 | E0005-bf16-flow-matching |
| H0006 | optimal VAE latent scaling factor differs from SD's 0.18215 on non-LAION datasets | ⚪ | — |

## H0001. v-prediction-converges-faster-low-noise

- **Statement**: under v-prediction parameterization, validation loss reaches the same plateau ~30% faster than ε-prediction in the low-noise regime (σ ∈ [0.002, 0.5]); the advantage shrinks toward parity at high noise
- **Origin**: Salimans & Ho 2022 observation, want to confirm on our internal dataset
- **Status**: ✅ CONFIRMED
- **Experiments**: E0001-vpred-convergence
- **Runs**: foo-260501-100000, bar-260502-150000
- **Evidence**:
  - v-pred reaches val_loss=0.072 at step=3500
  - ε-pred reaches the same val_loss at step=5100 (~31% slower)
  - low-noise bucket (σ<0.5) shows the largest gap; high-noise bucket within ±2%
- **Caveats**:
  - measured at 256² resolution only
  - both runs use the same EDM-style noise schedule; behavior on linear schedules unverified
- **Last verified**: 2026-05-02

## H0002. snr-weighted-loss-reduces-hf-artifacts

- **Statement**: min-SNR-γ loss weighting (γ=5) reduces high-frequency artifacts (measured by FFT high-band energy ratio) without hurting overall FID
- **Origin**: derived from SNR analysis of v-pred run
- **Status**: ✅ CONFIRMED
- **Experiments**: E0003-snr-sweep, E0001-vpred-convergence
- **Runs**: snr-sweep-260430-160000, bar-260502-150000
- **Evidence**:
  - HF-band energy ratio: baseline 0.184 → min-SNR-γ=5: 0.139 (-24%)
  - FID@256: baseline 8.92, γ=5: 8.87 (within noise)
  - effect strongest at γ ∈ [3, 7]; γ=10 starts to over-smooth
- **Caveats**:
  - "high-frequency artifact" metric is correlational, not causal
  - small-batch runs (bs=32) show much weaker effect
- **Last verified**: 2026-05-02

## H0003. zero-terminal-snr-tradeoff

- **Statement**: enforcing zero terminal-SNR (Lin et al. 2024) corrects mean-brightness drift but reduces compositional accuracy on multi-object prompts (measured via T2I-CompBench)
- **Origin**: derived from offset-noise / brightness-bias literature
- **Status**: 🟡 PARTIAL
- **Experiments**: E0001-vpred-convergence, E0002-zero-snr-eval
- **Runs**: foo-260501-100000, zero-snr-eval-260502-110000
- **Evidence**:
  - zero-SNR run: brightness bias |Δ|=0.011 (vs baseline 0.087, much better)
  - T2I-CompBench composition score: 0.41 (vs baseline 0.46, ~10% drop)
  - effect isolated to text-conditional path; unconditional samples unchanged
- **Caveats**:
  - tradeoff measured on a single CFG scale (7.5); rescale-CFG might mitigate
  - only 500 prompts evaluated; need larger eval set
- **Last verified**: 2026-05-02

## H0004. edm2-precond-beats-karras-edm

- **Statement**: EDM2-style preconditioning (Karras et al. 2024) yields ≥5% FID gain over the original EDM preconditioning at 256² ImageNet-1k
- **Origin**: extrapolation from EDM2 paper's 64²/128² numbers
- **Status**: ❌ REFUTED
- **Experiments**: E0004-edm2-precond
- **Runs**: edm2-precond-260503-080000
- **Evidence**:
  - EDM2 FID@256: 8.74
  - EDM (baseline) FID@256: 8.91
  - measured gain = 1.9%, well below the 5% threshold
- **Caveats**:
  - run crashed at step 84k with NaN in cross-attn (see edm2-precond-260503-080000/logs/stderr.log); FID computed from last good checkpoint
  - only one preconditioning hyperparameter set tested
- **Last verified**: 2026-05-03

## H0005. bf16-flow-matching-low-sigma

- **Statement**: bf16 flow-matching training loses gradient precision at σ < 0.02, manifesting as oscillating val_loss with no improvement after step ~10k
- **Origin**: numerical analysis discussion (bf16 ULP near zero)
- **Status**: 🔵 OPEN
- **Experiments**: E0005-bf16-flow-matching
- **Runs**: bf16-flow-matching-260503-093000
- **Evidence**:
  - run is in flight; preliminary val_loss curve shows oscillation but only 6k steps so far
- **Caveats**:
  - need fp32 control run; currently running concurrently
  - σ binning of loss not yet computed
- **Last verified**: —

## H0006. vae-scale-factor-dataset-dependent

- **Statement**: SD's hard-coded VAE latent scale 0.18215 is suboptimal for non-LAION pretraining datasets; per-dataset rescaling improves FID by ≥1 point
- **Origin**: speculation from per-channel latent statistics
- **Status**: ⚪ DEFERRED
- **Experiments**:
- **Runs**:
- **Evidence**:
  - none yet
- **Caveats**:
  - low priority; deferred until H0005 settles (bf16 stability is on the critical path)
- **Last verified**: —
