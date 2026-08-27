## Purpose

Defines the versioned cluster distribution and safe native foreground, rootless daemon, pinned update, verification, and rollback lifecycle.

## ADDED Requirements

### Requirement: Backend distribution is versioned and independently installable
The cluster distribution SHALL contain Backend, CLI, shared runtime/protocol code, and a manifest with release, exact revision, artifact digest, platform, and runtime requirements. It SHALL NOT require a central Web frontend build.

#### Scenario: Manifest matches running Backend
- **WHEN** Backend readiness is queried after install
- **THEN** its release and revision match the active distribution manifest

### Requirement: Native Backend lifecycle commands are complete and structured
The CLI SHALL provide `backend serve`, `backend daemon start|stop|restart|status`, `backend install --revision`, `backend update --revision`, `backend rollback`, and explicit token generation. Commands SHALL support a selected instance config and structured Agent-readable output containing action, outcome, installed/running version and revision, daemon/readiness state, and rollback outcome without secrets.

#### Scenario: Status distinguishes installed and running versions
- **WHEN** the active pointer and live worker do not match
- **THEN** status reports a mismatch rather than claiming the update succeeded

### Requirement: Native supervisor has single ownership and bounded restart
Supervised mode SHALL own one worker process group under a node-local exclusive lock. Duplicate start SHALL not create another worker. Intentional stop SHALL suppress restart. Unexpected exit SHALL restart with bounded exponential backoff and eventually enter an observable crash-loop state.

#### Scenario: Duplicate start is safe
- **WHEN** two start invocations race on one Host runtime directory
- **THEN** exactly one supervisor/worker wins and the other reports already-running or lock contention

#### Scenario: Stop remains stopped
- **WHEN** the operator intentionally stops the daemon
- **THEN** the supervisor does not recreate the worker and status reports stopped-by-operator

### Requirement: Runtime state is safe on shared NFS homes
PID, lock, socket, process start identity, and boot identity SHALL live in configured node-local runtime storage, not a shared home. Persistent config/releases/logs MAY use NFS, but running release bytes SHALL never be overwritten in place. Configured hostname and forbidden-environment guards SHALL be evaluated before creating runtime state or processes.

#### Scenario: Compute-job invocation is gated
- **WHEN** a start guard forbids an environment marker that is present in a compute job
- **THEN** start fails before locking, binding, or spawning a process

#### Scenario: Stale shared metadata cannot kill another process
- **WHEN** old metadata names a recycled PID with the wrong boot/start identity
- **THEN** lifecycle commands classify it as stale and do not signal that unrelated process

### Requirement: Pinned update is preflighted, immutable, and reversible
Install/update SHALL require an exact revision and fail before stopping the current worker when the managed checkout is dirty/divergent, the revision/digest cannot be verified, platform/runtime/dependency-lock checks fail, or build/tests fail. It SHALL never hard-reset, autostash, or independently resolve latest. A successful build SHALL enter an immutable release directory selected through an atomic pointer.

#### Scenario: Dirty checkout preserves live service
- **WHEN** update finds unexpected working-tree changes
- **THEN** it fails without modifying the checkout, active pointer, or running daemon

### Requirement: Activation verifies and rolls back automatically
Update SHALL retain a previous known-good release, activate/restart, then verify authenticated readiness, Host ID, capabilities, running release, and revision. Failure SHALL restore the prior pointer, restart and verify the prior worker, and report both activation and rollback outcomes.

#### Scenario: New worker fails readiness
- **WHEN** a new release starts but reports the wrong Host ID or never becomes ready
- **THEN** update restores and verifies the prior release and returns a failed-update-with-rollback result

### Requirement: Foreground, native, and external supervision share one worker contract
Foreground and externally supervised modes SHALL run the same Backend worker/readiness contract. In external mode, update SHALL return `restart_required` unless a configured safe restart argv exists; it SHALL NOT guess how to control a service manager. No mode SHALL promise automatic recovery across Host reboot.

#### Scenario: Reboot remains explicit
- **WHEN** a Host reboots without an external auto-start facility
- **THEN** central shows it offline/stopped until an Agent invokes the documented local start path
