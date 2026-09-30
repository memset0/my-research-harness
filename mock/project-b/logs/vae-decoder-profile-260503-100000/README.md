---
id: vae-decoder-profile-260503-100000
name: vae-decoder-profile
status: FAILED
created_at: 2026-05-03T10:00:00+08:00
updated_at: 2026-05-03T10:00:00+08:00
finished_at: 2026-05-03T10:30:00+08:00
host: bench-01
pid: null
gpus: [0]
archived: false
entry: ./run.sh
command: bash run.sh --workload=cfg_sweep --cfg=7.5 --profile=nsight --target=vae_decoder
wandb: null
---

## Setup

- same workload as cfg-diversity-decay at CFG=7.5
- nsight-cu-cli wrapping the inference loop
- target: VAE decoder kernels specifically (--target=vae_decoder)

## Result

- run exited with SIGSEGV at minute 3 (no profile output)
- nsight overhead may have changed pointer alignment in a way that
  triggered a latent UB in the VAE decoder (best guess based on the
  fault address landing inside the decoder's group-norm fused kernel)

## Artifacts

- `./logs/stdout.log` — partial run log
- `./logs/stderr.log` — SIGSEGV traceback
