## REMOVED Requirements

### Requirement: Run slug uniqueness within a project

**Reason**: The original v3 spec mandated unique run slugs within a
project, but that constraint was wrong: in practice, two attempts of
the same investigation share a slug and are disambiguated by their
timestamp suffix. The slug is descriptive metadata, not an identifier.
Forcing uniqueness rejected the natural "rerun the same experiment"
flow and the corresponding `DUPLICATE_RUN_SLUG` parse warning was a
false positive.

**Migration**: drop any code that branched on the
`DUPLICATE_RUN_SLUG` parse-warning code. The indexer no longer emits
it. The `ExperimentMembershipAnomalyCode` union no longer includes
`DUPLICATE_RUN_SLUG`. `memon doctor`'s `IssueCode` likewise drops it.
Run dir names continue to be unique (the timestamp suffix guarantees
that), and the `memon run rename` collision check still rejects a
true dir-name clash via the renamed code `DUPLICATE_RUN_DIR` (see the
`run-edit` delta).

Only EXPERIMENT slugs are constrained to be unique within a project,
per `experiment-readme`'s "Experiment slug uniqueness and prefix
rules" requirement (unchanged by this delta).
