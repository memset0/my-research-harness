---
id: E0004-vae-decoder-profile
slug: vae-decoder-profile
title: "VAE decoder kernel profiling"
status: OPEN
archived: false
runs: [vae-decoder-profile-260503-100000]
hypotheses: [H0003]
tags: [profile, nsight, vae]
created_at: 2026-05-03T10:00:00+08:00
updated_at: 2026-05-04T10:00:00+08:00
---

## Motivation

H0003 claims that in single-image SD-1.5 inference, the VAE decoder
accounts for ≥40% of wall time at p99 and is the dominant contributor
to the inference tail. The hypothesis was derived from
E0002-cfg-diversity-decay's tail-latency observations: prompts with
high LPIPS dispersion also tended to be the slow tail, and qualitative
inspection suggested the VAE decoder (not the U-Net) was the bottleneck
on those prompts.

The experiment is a focused nsight profile of the VAE decoder kernels
on the same workload as E0002 at CFG=7.5. The goal is a per-kernel
breakdown that either confirms the ≥40%-of-tail claim or attributes
the tail to a different module.

## Method

1. `vae-decoder-profile-260503-100000` — same workload as E0002 at
   CFG=7.5, 100 prompts. nsight-cu-cli wraps the inference loop with
   `--target=vae_decoder` to focus on the VAE decoder kernels
   specifically.
2. Dump the nsight report; expect a per-kernel time breakdown for the
   decoder.

## Conclusion

(In progress — see runs.)

The first attempt failed: nsight-cu-cli exited with SIGSEGV at minute
3 (no profile output). Best guess from the fault address is that
nsight overhead changed pointer alignment in a way that triggered a
latent UB in the VAE decoder's group-norm fused kernel. A rerun is
needed, possibly without nsight (use torch.profiler instead) or with
a different sampling rate.

H0003 remains 🔵 OPEN until a successful profile lands.

## Caveats

- Profiler may have caused the crash; before rerunning we should
  confirm the baseline CFG=7.5 workload still works without nsight
  (queued as a REQUEST in JOURNAL).
- nsight overhead is non-trivial; even if the profile succeeds, the
  absolute kernel timings may be slower than uninstrumented runs and
  ratios should be the load-bearing measurement, not absolute times.

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
