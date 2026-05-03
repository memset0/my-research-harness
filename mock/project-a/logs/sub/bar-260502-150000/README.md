---
id: bar-260502-150000
name: bar
project: project-a
status: FINISHED
created_at: 2026-05-02T15:05:00+08:00
finished_at: 2026-05-02T18:00:00+08:00
host: m2.cluster
pid: 12892
gpus: [0, 1, 2, 3]
entry: ./run.sh
command: bash run.sh --analyze=foo-260501-100000 --window=32
wandb: null
hypotheses: [H1, H2]
tags: [analysis, mosaic]
---

## Motivation

Analyze the per-step dump from foo-260501-100000 to test H1 (bf16 delta
sparsity) and H2 (grad magnitude sparsity).

## Setup

- single CPU job (no GPU needed for this analysis)
- input: foo-260501-100000/outputs/param_delta.npz
- window K ∈ {1, 8, 32, 160}

## Method

1. For each window K, compute fraction of (param, position) pairs where
   the value is bit-equal across all K steps
2. For grad magnitude: build per-tensor histogram, find threshold for
   target sparsity, measure norm retention

## Result

- 1-step bit_equal = 99.89%
- 8-step bit_equal = 99.34%
- 32-step bit_equal = 98.85%
- 160-step persistence = 97.23%
- Per-layer breakdown (1-step):
  - norm/embed/lm_head ~99.9%
  - attn/mlp ~99.8%
- Grad magnitude:
  - 93% of positions < 1e-8
  - threshold @1e-8 retains 99.7% of norm with 7% effective mask

## Conclusion

- H1 ✅ CONFIRMED at lr=1e-6 (see numbers above)
- H2 ✅ CONFIRMED for non-embed layers
- Embed/lm_head sparsity is structurally different (token-row driven) — see
  follow-up

## Caveats

- only one lr (1e-6); see H5 for generalization concern
- all numbers from one run; std error not estimated

## Artifacts

- `./outputs/sparsity_table.csv` — per-(layer, window) bit_equal numbers
- `./outputs/grad_hist/` — per-tensor magnitude histograms (one .npy per tensor)
- `./outputs/notes.md` — qualitative observations from manual inspection

## New Hypotheses

- **(candidate H7)** embed/lm_head per-row sparsity is far higher (~99.9%) than
  attn/mlp; structural separation may justify a layer-aware compression scheme.
  Worth a separate hypothesis entry in HYPOTHESES.md.
