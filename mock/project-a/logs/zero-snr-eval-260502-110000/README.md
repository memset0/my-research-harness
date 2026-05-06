---
id: zero-snr-eval-260502-110000
name: zero-snr-eval
experiment: E0002-zero-snr-eval
status: FINISHED
created_at: 2026-05-02T11:05:00+08:00
updated_at: 2026-05-02T11:05:00+08:00
finished_at: 2026-05-02T14:30:00+08:00
host: gpu-node-04
pid: 8810
gpus: [0, 1]
entry: ./eval.sh
command: bash eval.sh --eval=foo-260501-100000@step=4500 --bench=t2i-compbench --cfg_sweep=4.5,7.5,10
wandb: null
---

## Setup

- 2× A100, eval only (no training)
- 2 checkpoints compared:
  - foo @ step 4500 (zero terminal-SNR, v-pred)
  - snr-sweep γ=5 @ step 30000 (standard EDM schedule, ε-pred)
- 500 prompts from T2I-CompBench (color, shape, texture, spatial)
- 100 prompts from MS-COCO val for brightness eval
- CFG sweep ∈ {4.5, 7.5, 10}

## Result

Brightness bias |Δ| (lower better):

| CFG | foo (zero-SNR) | snr-sweep (baseline) |
| --- | -------------- | -------------------- |
| 4.5 | 0.009          | 0.061                |
| 7.5 | 0.011          | 0.087                |
| 10  | 0.018          | 0.114                |

T2I-CompBench composition score (higher better, CFG=7.5):

| Subscore  | foo (zero-SNR) | baseline |
| --------- | -------------- | -------- |
| color     | 0.49           | 0.54     |
| shape     | 0.38           | 0.42     |
| texture   | 0.36           | 0.41     |
| spatial   | 0.41           | 0.46     |
| **mean**  | **0.41**       | **0.46** |

- brightness bias dropped 7-9× across all CFG scales (large win)
- composition score dropped ~10% across all subscores (consistent loss)
- effect isolated to text-conditional path; unconditional samples (CFG=1.0)
  showed no composition delta

## Artifacts

- `./outputs/brightness_table.csv` — per-CFG brightness bias
- `./outputs/compbench_scores.json` — full per-subscore breakdown
- `./outputs/samples/` — 100 hand-picked side-by-sides (zero-SNR vs baseline)
