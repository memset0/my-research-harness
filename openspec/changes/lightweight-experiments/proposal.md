## Why

Experiment maintenance currently duplicates Run facts, requires development-stage documents and recomputes results during browsing. A small opt-in file model lets agents maintain research intent while execution records and explicit aggregation supply facts.

## What Changes

- Add `format: "lightweight"` to `experiment.json`, with column/group presentation definitions and optional per-Variant aggregation settings; membership and active selection come solely from Run directories and records.
- Create lightweight Experiments without mandatory README sections, research versions, implementation or investigation files.
- Aggregate one selected Run per Variant by default; explicitly selected custom aggregation calls experiment-local `aggregate_variant.py` per Variant.
- Persist a pure experiment `results.csv` for direct reading; failures preserve the previous file. Smoke and unselected historical Runs do not enter formal results.
- Preserve legacy bundles and their evidence filtering without implicit conversion.

## Capabilities

### New Capabilities
- `lightweight-experiments`: Lightweight declarations, creation, selected-Run aggregation and persisted result reads.

### Modified Capabilities

None. Existing format behavior remains compatible; this adds an explicitly selected format.

## Impact

Core experiment/results readers and writers, CLI experiment creation and result commands, and the shared summary model. Backend and Web consumers use the persisted result reader. The companion Run-record change supplies lightweight directory ownership. Filesystem migration and deployment are coordinated separately; no research project is converted automatically.
