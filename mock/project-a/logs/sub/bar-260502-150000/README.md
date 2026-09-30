---
id: bar-260502-150000
name: bar
status: FINISHED
created_at: 2026-05-02T15:05:00+08:00
updated_at: 2026-05-02T15:05:00+08:00
finished_at: 2026-05-02T18:00:00+08:00
host: gpu-node-07
pid: 12892
gpus: [0]
entry: ./analyze.sh
command: bash analyze.sh --analyze=foo-260501-100000 --window=5000
wandb: null
---

## Setup

- single GPU job (analysis only)
- input: foo-260501-100000/outputs/val_loss_per_sigma.npz + samples/
- noise buckets σ ∈ {0.002, 0.05, 0.5, 1.0, 5.0, 10, 20, 80}
- min-SNR-γ ∈ {1, 3, 5, 7, 10}

## Result

- v-pred reaches val_loss=0.072 at step 3500
- ε-pred reaches val_loss=0.072 at step 5100 (~31% slower; H0001 ✅)
- per-bucket gap (steps to threshold):
  - σ ∈ [0.002, 0.5]: v-pred 35-40% faster
  - σ ∈ [0.5, 5.0]: v-pred 12-18% faster
  - σ > 5.0: within ±2% (no advantage)
- min-SNR-γ FFT high-band ratio:
  - baseline 0.184
  - γ=3: 0.151
  - γ=5: 0.139 (best — H0002 ✅)
  - γ=7: 0.142
  - γ=10: 0.156 (over-smooth: low-band shifts up too)
- FID@256 with γ=5: 8.87 (vs baseline 8.92 — within noise)

## Artifacts

- `./outputs/h1_curves.csv` — per-bucket val loss curves
- `./outputs/h2_fft_ratios.csv` — FFT band ratios per γ
- `./outputs/notes.md` — qualitative observations from sample inspection
- `./logs/stdout.log` — analysis stdout
