## ADDED Requirements

### Requirement: The scheduler records one bounded receipt per scheduling event

The resident scheduler is a long-lived host and SHALL NOT open an ambient invocation. It SHALL record each scheduling event as its own complete receipt (origin `sched`, operation `sched <event>`, outcome `success` or — for `dispatch_failed` — `failure` with an error code) carrying only bounded metadata: the event, the project-relative Run path, pool and node names, GPU indices, priority, `preemptible`, `resumable`, the reason and the time with the writer's offset. Receipts SHALL NOT contain environment dumps, command lines with arguments, absolute paths, credentials or log content. Command files processed by the scheduler SHALL NOT produce a second receipt for the same event; the CLI invocation that wrote a command file SHALL keep its own ordinary receipt.

#### Scenario: Dispatch receipt content
- **WHEN** the scheduler dispatches `logs/a-261001-090000` to `sim-a` GPUs 0 and 1 at priority 5
- **THEN** exactly one `sched dispatched` receipt exists for it, naming that Run path, pool, node `sim-a`, GPUs `[0, 1]` and priority 5, and containing no absolute path or environment variable
