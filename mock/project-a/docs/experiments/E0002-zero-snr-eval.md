---
id: E0002-zero-snr-eval
slug: zero-snr-eval
title: "Zero-SNR brightness vs composition tradeoff"
runs: [zero-snr-eval-260502-110000]
hypotheses: [H0003]
tags: [zero-snr, brightness, compbench]
created_at: 2026-05-02T11:05:00+08:00
updated_at: 2026-05-04T10:00:00+08:00
---

## Motivation

H0003 predicts that enforcing zero terminal-SNR (Lin et al. 2024) fixes
mean-brightness drift but reduces compositional accuracy on multi-object
prompts. We measure both halves of that tradeoff using the
`foo-260501-100000` checkpoint (zero terminal-SNR, v-pred) against an
ε-prediction reference checkpoint trained without zero-SNR
(`snr-sweep` γ=5 @ step 30k).

The eval-only run quantifies brightness bias on COCO-val and composition
score on T2I-CompBench across CFG ∈ {4.5, 7.5, 10}. The result feeds
back into project-b's E0003-rescale-cfg as a candidate mitigation for
the composition loss.

## Method

1. `zero-snr-eval-260502-110000` — 2× A100 eval-only run consuming two
   checkpoints (foo @ 4500 and snr-sweep γ=5 @ 30000).
2. Generate 4 images per prompt per CFG scale per checkpoint
   (12k images total).
3. Brightness bias = mean luminance vs ground-truth mean luminance over
   500 COCO-val prompts.
4. T2I-CompBench scores via the official BLIP + UniDet evaluator over
   500 CompBench prompts spanning color / shape / texture / spatial
   subscores.

## Conclusion

H0003 🟡 partial. Both halves of the predicted tradeoff are real:

- Brightness bias |Δ| dropped 7–9× across all CFG scales (large win):
  CFG=4.5: 0.061 → 0.009; CFG=7.5: 0.087 → 0.011; CFG=10: 0.114 → 0.018.
- Composition score dropped ~10% across all subscores (consistent loss):
  mean CompBench score 0.46 → 0.41 at CFG=7.5.
- Effect is isolated to the text-conditional path; unconditional
  samples (CFG=1.0) show no composition delta.

Recommendation: keep zero-SNR as the default; explore rescale-CFG
(project-b H0004 / E0003-rescale-cfg) as a mitigation for composition
loss.

## Caveats

- Only 500 prompts on T2I-CompBench (the official set has 6k).
- Same text encoder (CLIP-L) used for both checkpoints — encoder
  differences are not factored out.
- Composition table reported only at CFG=7.5; other CFGs were not run
  through CompBench for cost reasons.

## Warnings

| Status | Created | Run | Category | Message | Resolved | Note |
| --- | --- | --- | --- | --- | --- | --- |
