## ADDED Requirements

### Requirement: Central terminal targets are Host-qualified
In central mode, terminal check/install/start/attach/list/stop, drawer/split/popup state, and proxy URLs SHALL identify one Host plus terminal target/session. Standalone behavior SHALL retain its existing local target shape.

#### Scenario: Drawer navigation preserves Host
- **WHEN** a terminal drawer is open for Host A and page navigation changes
- **THEN** it remains attached only to Host A unless the user explicitly opens another target

### Requirement: Central and Backend relay both ttyd HTTP and WebSocket
Central SHALL relay authenticated Host-qualified terminal HTTP and WebSocket traffic to the selected Backend's static relay. Backend SHALL resolve the opaque route to its local ttyd loopback port and perform the final hop. The browser SHALL never learn or address that dynamic port.

#### Scenario: Browser terminal works through public central endpoint
- **WHEN** an owner starts and opens a remote ttyd terminal
- **THEN** its assets and interactive WebSocket traverse central and Backend relays with working bidirectional I/O

### Requirement: Terminal credentials stop at their boundary
Central SHALL reject viewer terminal access, remove browser auth before the Backend hop, and inject only the Host's service token and trusted owner context. Backend SHALL reject browser cookies/Basic auth and a token for any other Host.

#### Scenario: Browser Authorization is not forwarded
- **WHEN** an owner uses HTTP Basic at central to open a terminal
- **THEN** the Basic header is consumed by central and the Backend sees only service authentication

### Requirement: Remote relay preserves ttyd semantics and cleanup
The two-hop relay SHALL preserve binary frames, allowed subprotocol, base-path asset resolution, backpressure, close propagation, copy/mouse behavior, and the existing manager's LRU/TTL/lifecycle semantics. Removed routes SHALL fail without retargeting.

#### Scenario: Idle eviction closes the exact remote route
- **WHEN** Backend evicts an idle ttyd entry
- **THEN** central can no longer attach that `{host, route}` and no other Host route is affected

## MODIFIED Requirements

### Requirement: Self-fetch ttyd from upstream releases without root

`POST /api/terminal/install` SHALL download the pinned ttyd version's prebuilt static binary for the current architecture from `https://github.com/tsl0922/ttyd/releases/download/<version>/ttyd.<arch>`. It SHALL also download the same release's `SHA256SUMS`, require one exact checksum entry for the selected asset, bound both checksum and binary response sizes, and verify the binary before writing it to `~/.cache/memon/bin/ttyd-<version>-<arch>` via temp-file + rename and `chmod +x`. Missing, malformed, oversized, or mismatched checksum data SHALL fail closed. The endpoint SHALL NOT require root or any system package manager and browser/central responses SHALL NOT expose the internal executable path.

The pinned version SHALL be a string constant in source (for example `TTYD_VERSION = '1.7.7'`); upgrading is a code change.

#### Scenario: First install on linux x86_64
- **WHEN** ttyd is missing and the user POSTs `/api/terminal/install` on a Host where `process.arch === 'x64'`
- **THEN** the owning Backend downloads `https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64`
- **AND** verifies sha256 against the exact `ttyd.x86_64` entry in the same release's `SHA256SUMS`
- **AND** writes the binary to `~/.cache/memon/bin/ttyd-1.7.7-x86_64` with mode 0755
- **AND** `--version` on that file outputs `ttyd version 1.7.7…`
- **AND** the public response contains the version and duration but not the cache path

#### Scenario: Concurrent install calls
- **WHEN** two install requests fire simultaneously
- **THEN** memon serializes them so only one network download happens; the second observes the installed cache entry
- **AND** the on-disk file is never observed in a partial state

#### Scenario: Network failure during download
- **WHEN** the release asset is unreachable or returns an error
- **THEN** installation fails with a safe `DOWNLOAD_FAILED` result
- **AND** no partial executable remains in the cache directory

#### Scenario: Checksum unavailable or malformed
- **WHEN** `SHA256SUMS` is unreachable, missing the selected asset, malformed, or exceeds its bound
- **THEN** installation fails closed with `INTEGRITY_FAILED`
- **AND** no downloaded binary is executed

#### Scenario: SHA256 mismatch
- **WHEN** the downloaded binary's sha256 does not match the selected `SHA256SUMS` entry
- **THEN** the temp file is deleted and installation fails with `INTEGRITY_FAILED`

#### Scenario: Install on macOS
- **WHEN** install is requested on `process.platform === 'darwin'` with no supported upstream prebuilt
- **THEN** installation reports `NOT_AUTOFETCHABLE` with a safe manual suggestion

#### Scenario: Cache hit on subsequent call
- **WHEN** a valid cached binary already exists at the expected path
- **THEN** installation short-circuits without network access and returns a safe `alreadyPresent` result
