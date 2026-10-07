# Independent memon file agent

The optional agent serves protocol-v1 file primitives to a central memon process.
It has no dependency on `@memon/backend`, no project parsers, no command execution,
and no filesystem watchers. Central business releases do not install or restart it.

Build on a native Linux host with a maintained Go toolchain (Go 1.27.1 or newer):

```sh
cd packages/file-agent
go build -o ./dist/memon-file-agent ./cmd/memon-file-agent
```

Copy that standalone binary using the operator's normal installation process.
Go is needed to build and test the agent, not to run it or update memon CLI nodes.
`MEMON_GO` selects a development compiler for the repository's build/test scripts.

Use an operator-owned JSON config and private certificate/key files. This neutral
example has one configured project and one certificate fingerprint grant:

```json
{
  "listen": "127.0.0.1:3738",
  "certificate": "./tls/server.pem",
  "key": "./tls/server-key.pem",
  "clientCA": "./tls/clients-ca.pem",
  "replayDirectory": "./state/replay",
  "projects": {
    "project-a": {
      "root": "/srv/project-a",
      "sourceIdentity": "source-a",
      "storageGroup": "storage-a",
      "readOnly": true
    }
  },
  "grants": {
    "<sha256-of-client-certificate-der>": { "project-a": "read" }
  }
}
```

Paths in this agent config are interpreted relative to the launching working
directory; project roots must be absolute. Keep deployment values in machine-local
configuration. The listener requires mutually verified TLS 1.3; HTTPS server name
verification remains enabled on the central client. An SSH tunnel can carry this
TLS connection without giving the agent a command endpoint.

```sh
./dist/memon-file-agent --config ./agent.json --describe
./dist/memon-file-agent --config ./agent.json
```

`--describe` prints exact source identities for central pins. The identity includes
the configured authority and backing root identity, survives an ordinary restart,
and changes if the backing authority changes. Central sends its expected identity;
reads and mutations reject a mismatched pin before performing file operations.

`SIGHUP` reloads certificates, trust, grants and project roots atomically. Existing
connections are reauthorized per request. Listener, replay location and capacity
limits require a restart. Active requests retain their prior snapshot until done;
new requests use the new grants. An invalid reload leaves the working configuration
in place.

## Write enablement and recovery

Remote writes are refused until the operator explicitly sets
`acknowledgedWriterLockVersion: 1` for that project, provides a `read-write` grant,
and clears `readOnly`. First upgrade every memon CLI writer using that project.
The agent cannot discover old writers or protect against editors/jobs that ignore
the common lock. Native memon CLI project writes and source RPC writes acquire
`.memon/locks/write-v1` using atomic directory creation; metadata/hash validation
and replacement occur within the cooperating writer's critical section.

A process killed without cleanup can leave that directory behind. Locks are never
stolen by age or PID. Before operator recovery, stop or otherwise verify that all
writers for that project have ended, reconcile any uncertain writes, then remove
only the abandoned lock directory. Resume writers afterward.

Whole-file replacement checks expected mtime and SHA1/SHA256 content hash (or
explicit absence), writes a sibling temporary file and atomically renames it.
Existing permission bits are preserved. Directory rename checks opaque entry
identity and an absent destination; it is not a content snapshot of the subtree.
Optional `directory-guards-v1` checks up to 32 distinct descendant file fingerprints
under the same writer lock before a directory move. Their combined reads are capped
by `maxBodyBytes`. A stale fingerprint conflicts even if timestamps are unchanged.
This protects named observed files, without claiming a recursive snapshot. Central
refuses a guarded move when an older agent lacks this capability.
Central deletion first renames to quarantine, then cleans members using bounded
operations. Failed cleanup may leave quarantine data; no multi-file atomicity is
promised. A final symlink unlink removes the link itself.

Replay keys are scoped to the authenticated certificate principal and bound to a
payload digest. Completed records survive restart within the advertised retention
(default 24 hours); different payloads cannot reuse a key. A crash after starting
but before durably recording completion returns `MUTATION_UNCERTAIN` on retry.
It never blindly repeats a delete, rename or replacement. Resolve uncertainty by
checking the source state before starting a new operation. Pending records count
against the bounded replay cap and are retained for explicit recovery.

## File protocol

Authenticated requests select a configured project ID and normalized relative
path, never an arbitrary root. All actual source operations use directory-relative
`os.Root` primitives. Escaping paths and symlink replacement races cannot redirect
an operation outside that authority. Optional expected mount type/source settings
make a missing network mount a source outage rather than an empty project.

- `GET /v1/capabilities`: independent protocol major, source identity, lock version,
  operation capabilities and body/range/batch/concurrency/replay limits.
- `GET /v1/read` and `/v1/list`: optional `knownVersion` or `If-None-Match`, returning
  content plus a SHA256 validator, confirmed missing, or a bodyless HTTP 304.
- `GET /v1/stat`, `/v1/lstat`, `/v1/resolve`: metadata and canonical relative paths.
  Metadata does not prove content equality.
- `GET /v1/range`: bounded offset/length reads, returned extent and a digest of the
  returned bytes. Truncation is distinguishable from an unchanged log.
- Optional `read-handles-v1`: `GET /v1/open-read` returns an opaque read token and
  metadata and an opaque dev/inode fileId from one opened regular file; `/v1/read-at` reads bounded ranges from
  that descriptor and `/v1/close-read` releases it. Tokens are bound to the TLS
  principal, project and source, with current grants checked on every request.
  At most 256 leases exist per agent process; five minutes of inactivity expires
  a lease. Leases are not persisted; expiry/restart returns `READ_HANDLE_EXPIRED`
  without reopening the path. Atomic replacement preserves old-file continuity;
  arbitrary in-place writes remain outside snapshot guarantees. Stable central
  streams require this optional capability; baseline dynamic ranges remain usable
  on older agents. Close/expiry retains active physical-read accounting until done.
- `POST /v1/batch`: bounded independent per-member reads, never a cross-file snapshot.
- `POST /v1/mutate`: conditional replacement, entry deletion, directory creation
  and same-project rename, with stable request ID and writer-lock version.

File requests carry `X-Memon-Expected-Source-Identity`; successful replies carry
`X-Memon-Source-Identity`. Conditional equality hashes the bytes actually read,
including same-size/same-mtime edits. An unchanged response avoids sending content;
it may still read source bytes. Arbitrary noncooperating in-place writes can produce
mixed observed bytes; callers reconcile parse errors through subsequent checks.

Replay admission is recorded as `not-started` before acquiring source capacity and
the common writer lock. Capacity or lock exhaustion at that stage may retry the
same ID, including after a process restart; a changed payload still conflicts.
Before changing project data, the agent durably advances the record to `pending`.
Completed replies replay without acquiring source capacity. A crash with a pending
record remains uncertain and never repeats the mutation automatically.

Default limits: 16 MiB whole-file body, 1 MiB range, 128 batch members, 10 concurrent
source operations and 10,000 replay records. `X-Memon-Concurrency` can request a
lower admission limit, never raise the server maximum. Descriptor-held source
slots outlive a caller disconnect while the physical operation is still running.
