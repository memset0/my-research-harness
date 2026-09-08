# project-read-performance Specification

## Purpose
Record first-stage performance improvements and truthful limits; archival is not a guarantee that all read latency is optimized.

## Requirements

### Requirement: Stage-one performance acceptance is bounded

Performance claims SHALL identify the observed operation or request scenario. Warm-cache and identity-only results SHALL NOT be represented as universal cold/detail/Git latency guarantees. Further optimization MAY follow independently of this phase's archival.

#### Scenario: Fast inventory but expensive detail
- **WHEN** identity enumeration avoids body reads but a selected detail still needs membership or Git work
- **THEN** the inventory improvement is reported without claiming the detailed work has been eliminated

### Requirement: Improvements preserve research and authorization boundaries

Read optimizations SHALL retain exact project identity, authorization, read-only data policy and source content. Cache data SHALL be rebuildable rather than a second research authority. The central primitive Store and scheduler SHALL own the accepted read architecture; this phase SHALL NOT require a parsed Backend snapshot, remote monitor or document SSE.

#### Scenario: Architecture replacement
- **WHEN** central serves a configured project directly
- **THEN** it retains the public read/share protections without deploying an old Backend cache service
