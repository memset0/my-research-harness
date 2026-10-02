## ADDED Requirements

### Requirement: Skills submit Runs to the scheduler without widening their authority

When a project uses the scheduler (an active lease reported by `memon sched status`, or the user says so), execution skills SHALL create Runs with `memon run create` and queue them with `memon sched submit` instead of launching them directly, passing `--priority` only with the exact integer the user gave (default `0`, negative values for background work the user marks as such) and never adjusting priorities on their own. They SHALL NOT pass `--preemptible` unless the user explicitly asked for that batch to be preemptible (with the user's request as `--preemptible-reason`), SHALL NOT start, stop or reconfigure `memon sched run` or edit the machine-local scheduler configuration without an explicit user request, SHALL NOT read or write files under `.memon/sched/` except through `memon sched` commands, and SHALL NEVER run `salloc`, `scancel`, `scontrol update` or any command that acquires, changes or releases an allocation. Pause, resume, cancel and priority changes SHALL go through `memon sched` commands and only on the user's request. Skills SHALL read queue state through `memon sched status` and history through `memon journal read --origin sched`. When a submitted Run keeps waiting for capacity, a skill SHALL report its waiting reason and MAY tell the user that raising the Run's priority is the way to move it forward, changing the priority only on the user's instruction.

#### Scenario: Batch submission
- **WHEN** the user asks to run eight seeds of `V0003` on a project with an active scheduler
- **THEN** the skill creates eight Runs, submits each with `memon sched submit` at the default priority with `preemptible: false`, and launches no process itself

#### Scenario: Allocation commands are off limits
- **WHEN** a submitted Run waits because all nodes are busy
- **THEN** the skill reports the waiting reason from `memon sched status` and runs no allocation or job-cancel command
- **AND** it changes no priority unless the user asks for it
