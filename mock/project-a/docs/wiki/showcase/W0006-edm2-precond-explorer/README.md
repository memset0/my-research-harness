---
id: W0006
kind: showcase
title: EDM2 preconditioning explorer
description: "Showcase page for E0004-edm2-precond: a paired Karras-EDM vs EDM2 preconditioning comparison at 256² on DiT-B/2, refuting H0004 with a measured 1.9% FID gain (8.91 → 8.74) and a ~20% faster convergence to best FID (80k vs 100k steps), pending clean rerun to clear the step-84k NaN confound."
status: READY
sources: [E0004]
tags: [edm2, demo]
created_at: "2026-05-04T12:00:00+08:00"
updated_at: "2026-05-04T13:00:00+08:00"
---

# EDM2 preconditioning explorer

## What to show

This page showcases the @E0004-edm2-precond head-to-head, where EDM2-style preconditioning (Karras et al. 2024) was grafted onto the project-a DiT-B/2 stack at 256² ImageNet to test @H0004's prediction of a ≥5% FID gain over the original Karras-EDM preconditioner. The bundle bundles a paired run dir @edm2-precond-260503-080000 and its clean rerun @edm2-precond-rerun-260503-100000, each carrying two threads that share a seed so the only difference is the preconditioning/target scaling (bs=128, lr=2e-4, EMA 0.9999, 120k steps, FID@256 every 20k on 10k samples). Headline numbers to surface: EDM FID@256 = 8.91 vs EDM2 FID@256 = 8.74, a measured 1.9% gain that refutes @H0004 ❌, while EDM2 reached best FID at step 80k versus 100k for the EDM baseline (~20% fewer steps). The view layer should also flag the open NaN-crash warning (step 84k of the EDM2 thread, `logs/stderr.log`) so readers know the EDM2 endpoint is extrapolated from the last good checkpoint until @edm2-precond-rerun-260503-100000 reports in.

```yaml datatable@1 #fid_by_precond
code: |
  import csv, os

  def collect(source, **kw):
      path = os.path.join(os.path.dirname(kw["__md_file_path"]), source)
      with open(path, newline="") as handle:
          rows = list(csv.DictReader(handle))
      return {
          "title": "FID by preconditioning (E0004)",
          "columns": ["step", "precond", "fid"],
          "data": [[int(r["step"]), r["precond"], float(r["fid"])] for r in rows],
          "views": [
              {"type": "table"},
              {"type": "line", "x": "step", "y": "fid", "series": "precond"},
          ],
      }
source: data/fid.csv
```

```html embed@1 #fid_bar_chart
<!doctype html><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-lite@5"></script>
<script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>
<div id="chart"></div>
<script>vegaEmbed('#chart', {
  "data": {"url": "./data/fid.csv"},
  "mark": "bar",
  "encoding": {
    "x": {"field": "step", "type": "ordinal"},
    "y": {"field": "fid", "type": "quantitative"},
    "color": {"field": "precond", "type": "nominal"},
    "xOffset": {"field": "precond"}
  }
}, {actions: false});</script>
```

```html embed@1 #fid_curve
<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
<div id="chart"></div>
<script>
fetch('./data/fid.csv').then(r => r.text()).then(t => {
  const rows = d3.csvParse(t, d3.autoType);
  const w = 640, h = 300, m = 40;
  const svg = d3.select('#chart').append('svg').attr('width', w).attr('height', h);
  const x = d3.scaleLinear().domain(d3.extent(rows, d => d.step)).range([m, w - m]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, d => d.fid)]).range([h - m, m]);
  const line = d3.line().x(d => x(d.step)).y(d => y(d.fid));
  for (const [k, g] of d3.group(rows, d => d.precond))
    svg.append('path').datum(g).attr('d', line).attr('fill', 'none').attr('stroke', k === 'edm2' ? '#e4572e' : '#4c78a8').attr('stroke-width', 2);
  svg.append('g').attr('transform', `translate(0,${h - m})`).call(d3.axisBottom(x));
  svg.append('g').attr('transform', `translate(${m},0)`).call(d3.axisLeft(y));
});
</script>
```

Full-window explorer: ![EDM2 explorer](./views/explorer/index.html)

## How to reproduce

Pull @edm2-precond-260503-080000 from the data/ bundle and load `views/fid-curve-256.json` to see both threads' FID vs step traces side by side; the paired-seed design means every divergence above noise is attributable to the preconditioner swap. For the crash context, open `runs/edm2-precond-260503-080000/logs/stderr.log` (id:w_2026-05-03T08-32-00+0800_a3f1) and cross-check that the FID@256 = 8.74 EDM2 number comes from the last good EMA snapshot before step 84k. To compare against the related v-pred / SNR evidence shown elsewhere, link the EDM2 preconditioning curve to @snr-sweep-260430-160000 (@H0002) and @foo-260501-100000 / @bar-260502-150000 (@H0001, @H0003); the convergence-speed delta here (~20%) is consistent in direction with @H0001's low-noise-regime result that v-pred reaches val_loss=0.072 at step=3500 vs 5100 for ε-pred. Once @edm2-precond-rerun-260503-100000 lands, re-run the same view regeneration to remove the NaN-confound from the EDM2 endpoint.

## Assets

Primary asset is the paired-run data bundle for @edm2-precond-260503-080000 (config, EMA checkpoints every 20k steps, FID eval logs, and `logs/stderr.log` documenting the step-84k NaN in cross-attn). Derived views under `views/` include `fid-curve-256.json` (FID@256 vs step for both threads), `best-fid-summary.md` (EDM 8.91 @ step 100k vs EDM2 8.74 @ step 80k, 1.9% delta, 20% step-to-best delta), and `precond-hparam-card.md` capturing the single EDM2-default hyperparameter set tested. The @edm2-precond-rerun-260503-100000 dir is staged but PENDING with NaN-skip patch and grad-clip 0.5 (vs 1.0); its artifacts will be appended to the same bundle once it finishes. Cross-references: @H0004 (refuted), @H0002 (min-SNR-γ = 5, FID 8.87 baseline 8.92, @H0003 brightness |Δ| 0.011 vs 0.087) for context on the same 256² regime.

