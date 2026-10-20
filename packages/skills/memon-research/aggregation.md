# Custom Variant aggregation

Create `aggregate_variant.py` in the Experiment directory only for a Variant
that needs custom aggregation. Set `variants.V0001.aggregate` in experiment.json
to that exact name. Input selection comes from each Run’s `active` flag.
The CLI calls the script separately for each selected Variant; it assembles
all outputs into the Experiment's `results.csv` atomically. Web readers never
execute scripts.

Input is one JSON object on stdin: `experiment`, `variant` (`id`, optional derived `name`), `columns`, and `runs`. Each Run supplies `id`, `path`,
`metadata` from `run.json`, `result_csv` and parsed `rows`.
Write `path,stat,value` CSV to stdout; use stderr for diagnostics. Return only
this Variant's aggregated measurements, never a Variant ID column or cache
metadata. Use Python's `csv` module for quoting. Choose a scientifically
appropriate statistic and document its meaning; do not silently choose the
latest Run. The default limit is 30 seconds and 4 MiB of output. Errors leave
the previous saved table unchanged.
