## Purpose

Provide a small authenticated file-operation protocol for accessing cluster project files without a mounted filesystem or a business-aware remote memon service.

## ADDED Requirements

### Requirement: File-only protocol has an independent lifecycle
The agent SHALL expose versioned file operations and capability discovery only. It SHALL NOT parse project business documents, generate indexes, execute commands, manage jobs or keep watch subscriptions. Protocol major version and optional capabilities SHALL be independent of memon release and filesystem convention versions. Central SHALL interoperate with older agents supporting the baseline protocol, and reject incompatible majors or required missing capabilities explicitly before project I/O.

#### Scenario: Business format changes
- **WHEN** central supports a new experiment format using existing file primitives
- **THEN** an existing compatible agent serves those bytes without upgrade or restart

#### Scenario: Incompatible protocol
- **WHEN** an agent advertises an unsupported protocol major
- **THEN** central reports protocol incompatibility without sending mutations or falling back to another source

### Requirement: Authentication and project permissions precede file access
The service SHALL require authenticated TLS with mutually verified service identities, configured project-scoped read or read-write grants and revocable credentials. A central browser session SHALL NOT itself authorize agent access. Credentials and endpoint selection SHALL remain operator-configured. Certificate/trust/grant rotation SHALL be reloadable atomically without restarting active business processes, and revoked identities SHALL fail subsequent requests. Source identity SHALL survive an ordinary agent restart and change when the configured underlying authority changes. File requests SHALL carry their expected source identity, which SHALL be checked before source operations; replay payload bindings SHALL include that authority.

#### Scenario: Untrusted caller
- **WHEN** an unauthenticated or untrusted client calls a file operation
- **THEN** the agent rejects it before accessing or revealing project paths

#### Scenario: Read-only identity
- **WHEN** a trusted client with a read grant requests a mutation
- **THEN** the agent refuses it even if central configuration allows writes

### Requirement: Paths remain inside configured project authorities
Requests SHALL select a configured project ID and normalized project-relative path. Absolute paths, traversal and escaping symlinks SHALL be refused, including create/rename destinations that do not exist yet. Containment SHALL be enforced at the source for reads and mutations; path replacement races SHALL not redirect an operation outside its authority. Mounted-root unavailability SHALL be distinguished from a confirmed missing child path.

#### Scenario: Escaping symlink
- **WHEN** a permitted project path resolves through a symlink outside its root
- **THEN** the operation fails without reading or writing the outside target

#### Scenario: Mount unavailable
- **WHEN** the backing project mount is absent or inaccessible
- **THEN** the agent reports source unavailability rather than a successful empty directory or missing file

### Requirement: Reads support optional content validators
A file read SHALL accept an optional opaque known version and return present content with its version, unchanged without content, or confirmed missing. The version SHALL identify the actual bytes read and SHALL change when those bytes differ. Versions SHALL NOT be derived solely from mtime and size. Metadata queries SHALL be separate and SHALL NOT claim content equality. Successful acceptance SHALL carry an observation time; cache reuse SHALL preserve the original time. Unchanged detection MAY read the source bytes to compute a validator and SHALL not promise avoidance of disk I/O. Arbitrary external in-place writes SHALL not be described as transactional snapshots; mixed observed bytes or parse failures SHALL be reconciled by later checks.

#### Scenario: Conditional unchanged read
- **WHEN** a caller supplies the version of the observed file bytes and those bytes remain equal
- **THEN** the agent returns unchanged with the version and no file body

#### Scenario: Same-size edit
- **WHEN** a file's bytes change while its size and coarse mtime remain equal
- **THEN** a content validation returns the changed bytes and a different version

### Requirement: Listings and bounded byte reads remain generic
Baseline metadata SHALL support observing the final symlink entry and resolving existing paths to canonical project-relative names without exposing absolute source paths. Direct-child listing SHALL support an optional version over its normalized sorted entries and return unchanged without entries when equal. That version SHALL NOT claim anything about child-file contents. The baseline SHALL provide bounded byte-range reading for logs and binary assets with explicit offset/length, returned extent, truncation/missing handling and a validator for the returned representation where requested. A bounded batch SHALL report independent per-item results and SHALL NOT promise a cross-file snapshot.

#### Scenario: Child content changes
- **WHEN** an existing child's bytes change without altering listed membership or requested entry metadata
- **THEN** the directory listing may remain unchanged while that file's conditional read returns new content

#### Scenario: Log was truncated
- **WHEN** a range request starts beyond a log's current length after truncation
- **THEN** the response exposes the current extent so the reader can reset its offset rather than silently following the wrong bytes

### Requirement: Conditional mutations preserve atomic replacement and conflicts
Whole-file replacement SHALL carry expected mtime and content hash, or an explicit create-if-absent precondition, and perform source-side validation and replacement under the shared memon writer lock protocol. A conflict SHALL leave the target unchanged and be mapped to HTTP 409 and CLI exit 9 where those surfaces apply. Writes SHALL use a same-directory temporary file and atomic rename with cleanup on failure, preserving the established mode policy. Mutations SHALL include the required directory create, conditional file/entry delete and contained same-project file/directory rename operations. Directory rename SHALL validate an opaque entry identity under the shared lock and require an absent destination; it SHALL NOT claim a recursive content snapshot. Directory moves and quarantine deletion SHALL carry bounded generic file fingerprint prerequisites for previously observed descendant documents. The source SHALL validate those mtime/hash prerequisites under the same writer lock before moving the directory, with an aggregate read-byte limit and a fixed maximum of 32 prerequisites. Central SHALL negotiate the optional directory-guards-v1 capability; older agents SHALL continue supporting baseline reads and file operations, but guarded directory operations SHALL fail explicitly without an unsafe fallback. Central recursive deletion SHALL first quarantine the directory with a conditional atomic rename and clean its members using bounded primitives; interrupted cleanup MAY leave the quarantine for explicit recovery. Multi-file business transactions SHALL remain central-coordinated and SHALL NOT be advertised as atomic. Guarantees SHALL explicitly exclude writers that ignore the shared locking protocol. Agent write enablement SHALL require an explicit operator acknowledgment that project memon writers use the compatible shared-lock protocol; without it the agent SHALL remain read-only. The service SHALL NOT claim it can automatically discover every legacy direct writer.

#### Scenario: Competing cooperating writer
- **WHEN** another memon writer changes a target before the agent obtains its shared lock and validates the expected fingerprint
- **THEN** the agent returns a conflict and does not replace the new bytes

#### Scenario: Descendant changed before directory move
- **WHEN** a descendant document changes after central observed it, even with unchanged coarse timestamps and directory identity
- **THEN** its fingerprint prerequisite conflicts before the directory is moved or quarantined

#### Scenario: Older agent lacks directory guards
- **WHEN** central needs a guarded directory move and the compatible agent lacks directory-guards-v1
- **THEN** central refuses that operation explicitly without sending an unguarded mutation, while baseline file reads remain available

#### Scenario: Replacement fails
- **WHEN** the final rename fails
- **THEN** the original file remains intact and temporary files are cleaned up

#### Scenario: Project writers are not acknowledged as upgraded
- **WHEN** a trusted client requests a mutation without the required project writer-upgrade acknowledgment
- **THEN** the agent refuses the mutation and continues serving authorized reads

### Requirement: Mutation retries have bounded replay semantics
Mutations SHALL carry a caller-scoped idempotency key bound to a payload digest. Duplicate accepted requests within the advertised retention period SHALL reuse the same result without repeating the mutation; reuse with a different payload SHALL fail. Replay records SHALL survive an ordinary agent restart and contain no file-body cache. Recovery SHALL distinguish completed, not-started and uncertain mutations; an uncertain request SHALL NOT be blindly replayed. Retention and restart limitations SHALL be explicit capabilities.

#### Scenario: Response lost after commit
- **WHEN** a completed request is retried with the same key and payload within retention
- **THEN** the same result is returned without another mutation

#### Scenario: Different payload reuses key
- **WHEN** a caller reuses an idempotency key for different content
- **THEN** the agent refuses the request without changing a file

### Requirement: Agent limits are independent of central scheduling
The agent SHALL enforce bounded request bodies, ranges, batches, concurrent operations and replay storage independently of central source budgets. Exhaustion SHALL return a bounded retryable result without unbounded queues. Batch members SHALL count as actual member work. Source errors, authorization failures, conflicts and missing paths SHALL remain distinct.

#### Scenario: Oversized batch
- **WHEN** a trusted client submits a batch above the advertised limit
- **THEN** the request is refused before unbounded filesystem work begins

### Requirement: Stable read handles are optional bounded file primitives
The optional read-handles-v1 capability SHALL open a contained regular file and return opaque read authority and metadata from that descriptor. Opened metadata SHALL include an opaque descriptor identity independent of ctime so large inode values retain precision and ordinary appends are distinguishable from replacement. Read-at SHALL retain the same descriptor across atomic pathname replacement and return bounded bytes with a content validator. Every operation SHALL check current authenticated principal, project grants, expected source identity and availability. Handles SHALL expire after five minutes of inactivity, remain bounded to 256 per process and be released on explicit close or service shutdown. Close or expiry SHALL NOT release capacity for physical reads still running. Lease state SHALL NOT be persisted; restart or expiry SHALL fail explicitly rather than reopen a pathname. Older compatible agents SHALL retain baseline operations, while stable streams SHALL refuse missing capabilities without a stateless-range fallback. Arbitrary in-place writes SHALL NOT be represented as transactional snapshots.

#### Scenario: File replaced during download
- **WHEN** a reader opens AAAAAA and a cooperating writer atomically replaces its pathname with BBBBBB between chunks
- **THEN** the opened stream continues reading AAAAAA with its opened-file metadata, without mixing the new file's bytes

#### Scenario: Lease expires or service restarts
- **WHEN** a reader uses an expired handle or one from a previous process
- **THEN** the operation fails explicitly and does not silently open a different file

#### Scenario: Grant revoked after opening
- **WHEN** a caller's grant is revoked after it opens a file
- **THEN** subsequent read-at requests fail before reading the retained descriptor
