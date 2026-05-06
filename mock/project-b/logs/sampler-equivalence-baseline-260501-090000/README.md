---
id: sampler-equivalence-baseline-260501-090000
name: sampler-equivalence-baseline
experiment: E0001-sampler-equivalence
status: FINISHED
created_at: 2026-05-01T09:00:00+08:00
updated_at: 2026-05-01T09:00:00+08:00
finished_at: 2026-05-01T11:00:00+08:00
host: bench-01
pid: 8421
gpus: [0]
entry: ./run.sh
command: bash run.sh --reruns=10 --sampler=ddim --steps=50 --ref-sampler=ddpm --ref-steps=1000
wandb: null
---

## Setup

- single A100 80GB
- SD-1.5 (frozen weights, no fine-tuning)
- 10 reruns of DDIM-50 + 3 reruns of DDPM-1000 on the same prompt set
- COCO-2017-val 5k captions, CFG=7.5, fp16 inference
- shared seed across reruns within each sampler (different across samplers)

## Result

- DDIM-50 FID: 12.48 ± 0.07 (10 reruns)
- DDPM-1000 FID: 12.51 ± 0.05 (3 reruns)
- difference well within reported variance (≤ 0.1 FID)
- DDIM-50 wall time: 1.4s / image
- DDPM-1000 wall time: 27.8s / image (~20× slower for the same FID)

## Artifacts

- `./outputs/runs.csv` — per-(sampler, run) FID + wall time
- `./outputs/fid_distribution.png` — boxplot
- `./logs/stdout.log` — short run log
