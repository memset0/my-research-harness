---
id: E0002-cfg-diversity-decay
slug: cfg-diversity-decay
title: "CFG scale erodes sample diversity"
runs: [cfg-diversity-decay-260502-090000]
hypotheses: [H0002]
tags: [cfg-sweep, diversity, lpips]
created_at: 2026-05-02T09:00:00+08:00
updated_at: 2026-05-04T10:00:00+08:00
---

## Motivation

H0002 claims that pairwise LPIPS distance over 4 samples per prompt
drops faster than linearly as CFG scale exceeds 7.5. This was an
anecdotal observation — high-CFG outputs look "samey" — that we want
to either confirm with a measurable diversity proxy or rule out as a
perceptual artifact.

The experiment measures pairwise LPIPS over four samples per prompt
across CFG ∈ {4.5, 7.5, 10, 12} on PartiPrompts-1k. The result also
feeds into project-a's E0002-zero-snr-eval and into project-b's
E0003-rescale-cfg as a baseline for the saturation-vs-diversity
tradeoff at high CFG.

## Method

1. `cfg-diversity-decay-260502-090000` — single A100, SD-1.5,
   DDIM-50. 1k prompts (PartiPrompts-1k subset), 4 samples per prompt
   per CFG. CFG ∈ {4.5, 7.5, 10, 12}, different seed per (prompt,
   sample), same prompt set across CFG.
2. For each prompt × CFG, compute pairwise LPIPS over the 4 samples
   (C(4,2) = 6 pairs), then average. Report mean and p99 across
   prompts.

## Conclusion

H0002 🟡 partial. The non-linear drop in pairwise LPIPS is real:

| CFG | mean LPIPS | p99 LPIPS | drop vs CFG=4.5 |
| - | - | - | - |
| 4.5 | 0.41 | 0.62 | — |
| 7.5 | 0.38 | 0.59 | -7% |
| 10 | 0.31 | 0.51 | -24% |
| 12 | 0.26 | 0.43 | -37% |

Non-linearity is clear past CFG=7.5; p99 collapses faster than the
mean (the tail of "stuck" prompts grows faster than the typical
prompt). However the conclusion is held as PARTIAL because only 4 CFG
points were sampled — we need to fill in CFG ∈ {6, 8, 9, 11} to
characterize the curve shape and add a non-LPIPS diversity proxy
(FID-coverage) to cross-check.

## Caveats

- PartiPrompts-1k only; LAION-art prompts may behave differently.
- bench-01 has a noisy NUMA peer, so wall-time numbers per CFG are not
  strictly comparable across runs.
- LPIPS is one diversity proxy; FID-coverage might disagree.

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
