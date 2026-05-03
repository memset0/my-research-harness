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
| H1 | v-prediction loss converges faster than ε-prediction in the low-noise regime | ✅ | foo-260501-100000, bar-260502-150000 |
| H2 | SNR-weighted (min-SNR-γ) loss reduces high-frequency artifacts | ✅ | bar-260502-150000, snr-sweep-260430-160000 |
| H3 | zero terminal-SNR schedule improves brightness fidelity but hurts compositional accuracy | 🟡 | foo-260501-100000, zero-snr-260502-110000 |
| H4 | EDM2-style preconditioning yields ≥5% FID gain over Karras-EDM at 256² | ❌ | baz-260503-080000 |
| H5 | bf16 flow matching loses convergence precision at σ < 0.02 | 🔵 | bf16-conv-260503-093000 |
| H6 | optimal VAE latent scaling factor differs from SD's 0.18215 on non-LAION datasets | ⚪ | — |

## H1. v-prediction-converges-faster-low-noise

- **Statement**: under v-prediction parameterization, validation loss reaches the same plateau ~30% faster than ε-prediction in the low-noise regime (σ ∈ [0.002, 0.5]); the advantage shrinks toward parity at high noise
- **Origin**: Salimans & Ho 2022 observation, want to confirm on our internal dataset
- **Status**: ✅ CONFIRMED
- **Experiments**: foo-260501-100000 (data) → bar-260502-150000 (analysis)
- **Evidence**:
  - v-pred reaches val_loss=0.072 at step=3500
  - ε-pred reaches the same val_loss at step=5100 (~31% slower)
  - low-noise bucket (σ<0.5) shows the largest gap; high-noise bucket within ±2%
- **Caveats**:
  - measured at 256² resolution only
  - both runs use the same EDM-style noise schedule; behavior on linear schedules unverified
- **Last verified**: 2026-05-02

## H2. snr-weighted-loss-reduces-hf-artifacts

- **Statement**: min-SNR-γ loss weighting (γ=5) reduces high-frequency artifacts (measured by FFT high-band energy ratio) without hurting overall FID
- **Origin**: derived from SNR analysis of v-pred run
- **Status**: ✅ CONFIRMED
- **Experiments**: bar-260502-150000, snr-sweep-260430-160000
- **Evidence**:
  - HF-band energy ratio: baseline 0.184 → min-SNR-γ=5: 0.139 (-24%)
  - FID@256: baseline 8.92, γ=5: 8.87 (within noise)
  - effect strongest at γ ∈ [3, 7]; γ=10 starts to over-smooth
- **Caveats**:
  - "high-frequency artifact" metric is correlational, not causal
  - small-batch runs (bs=32) show much weaker effect
- **Last verified**: 2026-05-02

## H3. zero-terminal-snr-tradeoff

- **Statement**: enforcing zero terminal-SNR (Lin et al. 2024) corrects mean-brightness drift but reduces compositional accuracy on multi-object prompts (measured via T2I-CompBench)
- **Origin**: derived from offset-noise / brightness-bias literature
- **Status**: 🟡 PARTIAL
- **Experiments**: foo-260501-100000, zero-snr-260502-110000
- **Evidence**:
  - zero-SNR run: brightness bias |Δ|=0.011 (vs baseline 0.087, much better)
  - T2I-CompBench composition score: 0.41 (vs baseline 0.46, ~10% drop)
  - effect isolated to text-conditional path; unconditional samples unchanged
- **Caveats**:
  - tradeoff measured on a single CFG scale (7.5); rescale-CFG might mitigate
  - only 500 prompts evaluated; need larger eval set
- **Last verified**: 2026-05-02

## H4. edm2-precond-beats-karras-edm

- **Statement**: EDM2-style preconditioning (Karras et al. 2024) yields ≥5% FID gain over the original EDM preconditioning at 256² ImageNet-1k
- **Origin**: extrapolation from EDM2 paper's 64²/128² numbers
- **Status**: ❌ REFUTED
- **Experiments**: baz-260503-080000
- **Evidence**:
  - EDM2 FID@256: 8.74
  - EDM (baseline) FID@256: 8.91
  - measured gain = 1.9%, well below the 5% threshold
- **Caveats**:
  - run crashed at step 84k with NaN in cross-attn (see baz/logs/stderr.log); FID computed from last good checkpoint
  - only one preconditioning hyperparameter set tested
- **Last verified**: 2026-05-03

## H5. bf16-flow-matching-low-sigma

- **Statement**: bf16 flow-matching training loses gradient precision at σ < 0.02, manifesting as oscillating val_loss with no improvement after step ~10k
- **Origin**: numerical analysis discussion (bf16 ULP near zero)
- **Status**: 🔵 OPEN
- **Experiments**: bf16-conv-260503-093000
- **Evidence**:
  - run is in flight; preliminary val_loss curve shows oscillation but only 6k steps so far
- **Caveats**:
  - need fp32 control run; currently running concurrently
  - σ binning of loss not yet computed
- **Last verified**: —

## H6. vae-scale-factor-dataset-dependent

- **Statement**: SD's hard-coded VAE latent scale 0.18215 is suboptimal for non-LAION pretraining datasets; per-dataset rescaling improves FID by ≥1 point
- **Origin**: speculation from per-channel latent statistics
- **Status**: ⚪ DEFERRED
- **Experiments**: —
- **Evidence**:
  - none yet
- **Caveats**:
  - low priority; deferred until H5 settles (bf16 stability is on the critical path)
- **Last verified**: —
