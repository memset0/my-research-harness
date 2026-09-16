## Purpose

Translate bounded document prose through locally authenticated Codex Spark without exporting credentials, enabling document-driven tools, or silently changing billing providers.

## ADDED Requirements

### Requirement: Use local ChatGPT authentication and the requested Spark model

The translation provider SHALL execute on the serving Web/central instance, or the standalone instance when used standalone, using its configured local Codex installation and existing managed ChatGPT login. The selected model SHALL be exactly `gpt-5.3-codex-spark`. Browser input SHALL NOT select a command, Codex home, credential, provider, or working directory. The provider SHALL reject missing login, API-key-only authentication, and unavailable Spark access without falling back to a different model or billing route. Credential refresh SHALL remain Codex-owned.

Serving-process configuration SHALL be disabled by default. Enabling translation, selecting a trusted local executable, and optionally selecting its native `auth.json` file SHALL require operator-controlled environment configuration, not browser input. The executable SHALL accept a PATH command or symlink without canonicalizing its installation path. The auth path SHALL name an existing native `auth.json` file; its containing directory becomes the child Codex home with file credential storage enforced. The wrapper SHALL NOT read or copy tokens and Codex SHALL retain credential refresh ownership. Unsupported CLI versions SHALL fail closed until protocol and isolation are revalidated.

#### Scenario: Operator selects executable and credentials
- **WHEN** the operator supplies `codex` and an existing native `auth.json` path
- **THEN** invocation resolves the command through the serving process PATH and uses that file's directory without copying credentials
- **AND** invalid or missing auth paths produce a redacted configuration failure before provider startup

#### Scenario: Available local account
- **WHEN** the configured local Codex account supports Spark and an owner requests translation
- **THEN** the provider uses that account and the exact Spark model
- **AND** neither browser clients nor remote project services receive its authentication material

#### Scenario: Account or model is unavailable
- **WHEN** login is absent, only an API key is configured, or Spark is unavailable
- **THEN** translation reports the specific availability failure with original prose intact
- **AND** no alternative model or provider is invoked

### Requirement: Translation sessions are isolated and data-only

Every translation invocation SHALL use an ephemeral session and a controlled non-project working directory. Document content SHALL be treated as untrusted translation data, never as commands. Shell execution, file writes, browsing, MCP/app tools, inherited project instructions, and other agent capabilities SHALL be disabled for translation; inability to enforce the required capability restrictions SHALL fail closed. Read-only mode alone SHALL NOT count as disabling reads or tool execution. Provider credentials SHALL not be included in prompts, responses, diagnostic logs, or translation caches.

#### Scenario: Malicious body instruction
- **WHEN** a body asks the translator to read a credential file or execute a shell command
- **THEN** it remains translation data and no tool action runs
- **AND** a tool request or unsupported isolation configuration terminates the invocation safely

### Requirement: Protocol completion and output are validated

The wrapper SHALL distinguish transport events, intermediate commentary, final translation output, and terminal failures. Only correctly correlated final translation output SHALL satisfy segment results. Successful process start or partial text SHALL NOT imply translation success. Broken protocol, invalid output, early process exit, or failed turns SHALL produce bounded, redacted failures and settle all outstanding requests.

#### Scenario: Partial response followed by process exit
- **WHEN** Codex emits intermediate output and exits before successful completion
- **THEN** unvalidated output is not installed as a completed translation
- **AND** pending segments receive an actionable failure

### Requirement: Bound lifetime and quota-related retries

All translation-owned Codex invocations, including readiness and executable probes, SHALL share a process-global limit of two concurrent invocations. At most 32 additional invocations SHALL wait in FIFO order. Cancelled or timed-out waiters SHALL be removed without launching Codex. A slot SHALL remain occupied through child cleanup and SHALL be released on success or failure.

#### Scenario: Readiness and translation contend for capacity
- **WHEN** two Codex invocations are active and another owner requests readiness or translation
- **THEN** the new invocation waits without spawning another Codex process
- **AND** cancellation removes the waiter, while completion admits the next live waiter

Timeout or cancellation SHALL stop the active turn, terminate remaining owned child processes after a bounded grace period, and clean up temporary resources. Quota exhaustion, authentication errors, unsupported model/protocol, and policy restrictions SHALL not be automatically retried. Only transient transport failures SHALL receive bounded backoff retries. Status output SHALL report safe readiness and failure information without claiming guaranteed quota availability or exposing account identity, raw stderr, or secrets.

#### Scenario: Quota exhaustion
- **WHEN** Spark reports exhausted quota
- **THEN** pending work stops issuing further model calls until an explicit retry
- **AND** the UI explains the failure without silently selecting another model

#### Scenario: Cancel an unresponsive turn
- **WHEN** cancellation or timeout occurs and Codex does not stop cooperatively
- **THEN** the wrapper enforces bounded termination and releases concurrency capacity
- **AND** temporary resources and listeners are cleaned up
