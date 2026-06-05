---
title: FSDP all-gather / compute overlap
description: Overlap the FSDP parameter all-gather with forward compute to cut step time on the 8-GPU node.
experiment: null
created_at: 2026-05-24T14:10:00+08:00
updated_at: 2026-06-05T01:01:16+00:00
commits:
  - repo: .
    sha: 3f9a1c2d4e5b6a7c8d9e0f1a2b3c4d5e6f708192
    url: https://github.com/acme/project-a/commit/3f9a1c2d4e5b6a7c8d9e0f1a2b3c4d5e6f708192
    subject: 'perf(fsdp): prefetch next-layer all-gather during forward'
    reviewed: false
  - repo: third_party/fsdp-ext
    sha: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4
    url: https://github.com/acme/fsdp-ext/commit/a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4
    subject: 'feat(stream): expose a dedicated comm stream handle'
    reviewed: false
review_todolist:
  - item: Confirm prefetch depth 1 does not blow up activation memory on the 7B config
    done: true
  - item: Check the comm stream is synced before the optimizer step (no race on grad buffers)
    done: false
---

# FSDP all-gather / compute overlap

## Requirement

- Driving need (perf): the 8xA100 step time is dominated by a serial FSDP all-gather that
  stalls compute. Goal: overlap the next layer's all-gather with the current layer's forward.
- Agreed scope: forward path only; do NOT touch the backward reduce-scatter or change the
  sharding strategy. Prefetch depth fixed at 1 layer for this pass.

## Changes

### perf(fsdp): prefetch next-layer all-gather during forward

#### Deliverables
- `src/fsdp/overlap.py`: schedule layer N+1 all-gather on a side stream while layer N computes.
  Corresponds to commit `3f9a1c2` (main repo).

#### Design Decisions
The stall comes from the all-gather and the GEMM sharing the default CUDA stream, so they
serialize. Moving the all-gather to a dedicated stream lets the copy engine run concurrently
with the SMs. The achievable speedup is bounded by Amdahl over the comm fraction $f$:
$$ \text{speedup} = \frac{1}{(1 - f) + \frac{f}{1 + o}} $$
where $o$ is the overlap fraction. With $f \approx 0.35$ and near-full overlap ($o \to 1$) we
expect ~1.2x. Rejected: bucketing all layers into one giant all-gather (kills memory).

#### Analysis
Key change is the stream handoff:
```python
with torch.cuda.stream(comm_stream):
    prefetch_all_gather(layer[n + 1])              # concurrent with layer[n] forward
torch.cuda.current_stream().wait_stream(comm_stream)  # sync before consuming params
```
Full implementation: https://github.com/acme/project-a/blob/3f9a1c2d4e5b6a7c8d9e0f1a2b3c4d5e6f708192/src/fsdp/overlap.py#L40-L88

#### Verification
Single-node forward timing: 1.18x step speedup at seq 4k; loss curve bit-identical for 50 steps.

#### Details
Prefetch depth is hard-coded to 1; a config knob is deliberately deferred (see Notes).

### feat(stream): expose a dedicated comm stream handle

#### Deliverables
- submodule `third_party/fsdp-ext`: public `comm_stream()` accessor. Commit `a1b2c3d` (submodule).

#### Design Decisions
The overlap needs a stable, reusable stream; allocating one per step thrashes the caching
allocator. Expose a singleton comm stream from the extension.

#### Analysis
Below is pseudocode:
```text
comm_stream():
    if _stream is None:
        _stream = cuda.Stream(priority=-1)
    return _stream
```
Full entry: https://github.com/acme/fsdp-ext/blob/a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4/csrc/stream.cc#L12-L30

#### Verification
Backward-compat: callers that do not request the stream see identical behavior.

#### Details
None.

## Verification

- Experiment: a smoke run on the 7B config completed 50 steps with overlap enabled, no OOM.
- Unit tests: `pytest tests/test_overlap.py` -> 4 passed (stream sync, memory ceiling, loss parity).

## Notes

- Special request: keep prefetch depth at 1 for this pass (reviewer wants the mechanism landed
  before tuning depth).
- Counter-intuitive: a *higher*-priority comm stream slowed compute by starving the GEMM
  kernels; priority -1 (lower) was the sweet spot.
- Lesson / future work: prefetch depth should become a config field; depth > 1 needs an
  activation-memory model first.
