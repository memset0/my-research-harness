## ADDED Requirements

### Requirement: Operations are charted per project

The File access page SHALL chart source operations per storage group over the selected metrics window in fixed buckets, and the execution time of the most recent physical operations (bounded to 300), naming each storage group by the projects that read through it.

#### Scenario: Two projects read at once
- **WHEN** projects on two storage groups read files within the selected window
- **THEN** the request chart shows one line per project with its operations per bucket, and the latency chart shows one dot per recent operation in that project's color
