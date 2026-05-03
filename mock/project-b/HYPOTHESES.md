# project-b hypotheses

## Status legend

| Symbol | Status |
| :---: | --- |
| ✅ | CONFIRMED |
| ❌ | REFUTED |
| 🟡 | PARTIAL |
| 🔵 | OPEN |
| ⚪ | DEFERRED |

## Summary table

| ID | Statement | Status | Experiments |
| :-: | --- | :-: | --- |
| H1 | baseline measurement is reproducible | ✅ | exp1-260501-090000 |
| H2 | tail latency degrades non-linearly with concurrency | 🟡 | exp2-260502-090000 |
| H3 | profile shows kernel stalls | 🔵 | exp3-260503-100000 |
| H4 | nested optimization reduces stall by 30% | ⚪ | — |

## H1. baseline-reproducible

- **Statement**: baseline measurement converges within 1% over 10 reruns
- **Origin**: methodology
- **Status**: ✅ CONFIRMED
- **Experiments**: exp1-260501-090000
- **Evidence**:
  - mean = 12.5ms, std = 0.07ms over 10 reruns
- **Caveats**:
  - same machine only; cross-host variance untested
- **Last verified**: 2026-05-01

## H2. tail-latency-degrades

- **Statement**: > p99 latency grows non-linearly with concurrency
- **Origin**: observation
- **Status**: 🟡 PARTIAL
- **Experiments**: exp2-260502-090000
- **Evidence**:
  - p99 = 18ms @ concurrency=1
  - p99 = 72ms @ concurrency=8 (4× ratio for 8× concurrency)
- **Caveats**:
  - only 2 concurrency points; need a finer sweep
- **Last verified**: 2026-05-02

## H3. profile-shows-stalls

- **Statement**: nsight profile reveals memory-bound kernel stalls
- **Origin**: derived from H2
- **Status**: 🔵 OPEN
- **Experiments**: exp3-260503-100000
- **Evidence**:
  - profile run failed (SIGSEGV); needs rerun
- **Caveats**:
  - run instrumentation may have caused crash
- **Last verified**: —

## H4. nested-opt-reduces-stall

- **Statement**: nested loop tiling reduces stall fraction by ≥30%
- **Origin**: design proposal
- **Status**: ⚪ DEFERRED
- **Experiments**: —
- **Evidence**:
  - none yet
- **Caveats**:
  - blocked on H3 baseline measurement
- **Last verified**: —
