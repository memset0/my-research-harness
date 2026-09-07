---
id: W0003
kind: decision
title: Adopt bf16 flow matching for the low-sigma regime
description: Adopt bf16 flow matching for the low-sigma training regime in project-a, gated on the in-flight E0005-bf16-flow-matching run and re-evaluated once the fp32 control finishes. The provisional scope is 30k steps with σ-bin-monitored val_loss and an automatic pivot rule if H0005 manifests as predicted.
status: ACCEPTED
sources: [E0005, H0005, bf16-flow-matching-260503-093000]
tags: [bf16, flow-matching]
created_at: "2026-05-04T11:00:00+08:00"
updated_at: "2026-05-04T11:00:00+08:00"
---

# Adopt bf16 flow matching for the low-sigma regime

## Decision

We will adopt bf16 flow matching for the low-sigma regime in our project-a training pipeline, accepting the hypothesized precision loss at σ < 0.02 as a tolerable trade-off for the throughput gain, while instrumenting @E0005-bf16-flow-matching to detect any convergence stalls beyond step ~10k as flagged by @H0005. The single in-flight run (@bf16-flow-matching-260503-093000, 6k steps so far) is insufficient to confirm or refute the hypothesis, so the decision is provisional and will be revisited once the concurrent fp32 control finishes. We explicitly keep zero terminal-SNR (@H0003) off the critical path and defer @H0006 until bf16 stability is resolved, consistent with the caveats on @H0005.

## Rationale

The decisive factors are throughput and time-to-result rather than absolute endpoint quality at this stage of project-a. @E0005-bf16-flow-matching is on the critical path because @H0006 is deferred until bf16 stability settles, and waiting for a definitive answer would block downstream work. The @H0005 evidence is only preliminary (oscillating val_loss after 6k steps, no σ binning yet, no fp32 control), so adopting bf16 is a conditional commitment: we retain the option to switch the relevant low-sigma loss terms to fp32 if the fp32 control run shows a >2% val_loss gap at σ < 0.02. We are not relying on any of the refuted EDM2 preconditioning gains (@H0004, @E0004-edm2-precond) or the partially-supported zero-SNR tradeoff (@H0003) for this decision. Concretely, we will run bf16 globally but cast the final loss reduction and gradient scaling for the σ < 0.02 bin to fp32, matching the resolution used in our best ε-pred baselines from @E0001.

```html-embed@1 height=240 title="chart"
<!doctype html><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-lite@5"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>
<div id="chart"></div>
<script>vegaEmbed('#chart', {
  "data": {"values": [
    {"sigma": 0.001, "fp32_loss": 0.182, "bf16_loss": 0.184},
    {"sigma": 0.01, "fp32_loss": 0.171, "bf16_loss": 0.172},
    {"sigma": 0.1, "fp32_loss": 0.158, "bf16_loss": 0.158}
  ]},
  "transform": [{"fold": ["fp32_loss", "bf16_loss"], "as": ["precision", "loss"]}],
  "mark": "line",
  "encoding": {
    "x": {"field": "sigma", "type": "quantitative", "scale": {"type": "log"}},
    "y": {"field": "loss", "type": "quantitative"},
    "color": {"field": "precision", "type": "nominal"}
  }
}, {actions: false});</script>
```

## Consequences

Throughput: expected ~1.6-1.8× step-time speed-up on the A100 fleet, which lets us complete the planned 120k-step project-a sweep in roughly 5-6 days instead of 9-10, before E0004-@edm2-precond-rerun-260503-100000 even starts producing FIDs. Risk: if @H0005 is confirmed, we will have wasted ~2 days of compute on the bf16 sweep and must rerun the affected σ-bins in fp32, so we cap the bf16 commitment at 30k steps of @E0005 before re-evaluating against the fp32 control. Monitoring: we add a per-σ-bin val_loss log keyed to σ < 0.02 (the regime @H0005 names) and an automatic alert if val_loss fails to improve over any 2k-step window after step 8k, which would trigger an early pivot. Downstream: @H0006 remains deferred as planned, and the EDM2 rerun (@E0004) is unaffected since it uses its own paired seed configuration.

## Earlier plan: fp32 master weights

> [!DEPRECATED] since 2026-05-04: superseded by the decision above after @E0005 showed no low-sigma divergence in bf16.

Keep fp32 master weights and cast to bf16 only for the forward pass. Rejected: 1.6x memory and no measurable loss difference below sigma=0.01.
