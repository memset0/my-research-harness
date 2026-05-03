---
id: exp3-260503-100000
name: exp3
project: project-b
status: FAILED
created_at: 2026-05-03T10:00:00+08:00
finished_at: 2026-05-03T10:30:00+08:00
host: bench-01
pid: null
gpus: [0]
entry: ./run.sh
command: bash run.sh --workload=cfg_sweep --cfg=7.5 --profile=nsight --target=vae_decoder
wandb: null
hypotheses: [H3]
tags: [profile, nsight, vae]
---

## Motivation

Capture an nsight profile of SD-1.5 inference at CFG=7.5 to look for the
VAE-decoder tail predicted by H3.

## Setup

- same workload as exp2 at CFG=7.5
- nsight-cu-cli wrapping the inference loop
- target: VAE decoder kernels specifically (--target=vae_decoder)

## Method

Wrap the inference binary with nsight, run on 100 prompts, dump report.

## Result

- run exited with SIGSEGV at minute 3 (no profile output)
- nsight overhead may have changed pointer alignment in a way that
  triggered a latent UB in the VAE decoder (best guess based on the
  fault address landing inside the decoder's group-norm fused kernel)

## Conclusion

- H3 still 🔵 OPEN — profile incomplete.
- Need a rerun, possibly without nsight (use torch.profiler instead) or
  with a different sampling rate.

## Caveats

- profiler may have crashed the workload; rerun without profiler first to
  confirm baseline CFG=7.5 still works (queued as a REQUEST in JOURNAL)

## Artifacts

- `./logs/stdout.log` — partial run log
- `./logs/stderr.log` — SIGSEGV traceback
