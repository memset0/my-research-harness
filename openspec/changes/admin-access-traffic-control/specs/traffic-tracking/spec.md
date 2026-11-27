## ADDED Requirements

### Requirement: Forwarded requests are measured in bounded memory
Central SHALL record every forwarded content-service request (HTTP and WebSocket) and every content-asset request with its Host, Project, transport (`native`, `ssh-tunnel` or `file-agent`), document, method, path, status, response bytes, central resolve time, time to first byte from arrival, upstream time to first byte, total duration, whether the upstream connection was reused, and an outcome (`ok`, `error` or `aborted`). The recorded path SHALL exclude the query string and SHALL be truncated to at most 160 characters. Throughput SHALL be derived only for bodies of at least 32 KiB. State SHALL be held in memory only: a ring buffer of at most 1000 recent records, per Host/Project/transport one-minute aggregates over the last 60 minutes for at most 128 keys, and at most 20 probe results. Tracking SHALL NOT change forwarding behavior, and failures inside tracking SHALL NOT fail a request. A restart starts empty.

#### Scenario: Slow service resource
- **WHEN** a browser loads `/api/content-services/h1/project-a/report/R0001/static/app.js?token=x` and the upstream answers after 2 s with 3 MiB
- **THEN** the latest record names `h1/project-a`, its transport and `report/R0001`, shows path `/static/app.js?…`, an upstream time to first byte of about 2 s, 3 MiB and a throughput, and never contains `token=x`

#### Scenario: Bounded history
- **WHEN** 1500 forwarded requests complete
- **THEN** only the most recent 1000 records are retained and per-key aggregates still count all requests in their window

### Requirement: Traffic snapshot is owner-only
`GET /api/traffic?windowMs=N` SHALL require `configure_instance` and SHALL return per-Host/Project/transport aggregates for a window of 5, 15 or 60 minutes (count, errors, slow count over 2 s, bytes, mean and p95 time to first byte, mean and p95 total, throughput), the most recent records, the slowest records in the window, the configured Projects with their transport and probe support, and recent probe results. Timestamps SHALL be ISO 8601 with the central's local offset.

#### Scenario: Admin is refused
- **WHEN** an `admin` session requests `GET /api/traffic`
- **THEN** the response is `403`

### Requirement: Central-to-host probe through the same transport
`POST /api/traffic/probe {host, project, document?, path?}` SHALL require `configure_instance` and measure the central→host leg through the Project's own transport without installing anything on the remote host: for a File Agent Project, sequential capability requests over one keep-alive mTLS connection (connection setup and steady round-trip time); for an SSH-reached Project, an SSH session's setup time, one-byte echo round trips, and a bounded random-byte download measured with standard `cat`/`head`; for a native Project, a statement that there is no network leg. With a service document, it SHALL also fetch the given path (default `/`) through the live forwarding target, capped at 16 MiB, reporting time to first byte, bytes and throughput. A Project that no transport can probe SHALL report that with its reason. Only one probe per Project SHALL run at a time.

#### Scenario: File Agent probe
- **WHEN** the owner probes a File Agent Project
- **THEN** the result shows the first request's setup time and the median, minimum and maximum steady round trip to the agent

#### Scenario: Unprobeable Project
- **WHEN** the owner probes a Project whose storage is SSHFS without an SSH execution target
- **THEN** the result says the transport cannot be probed and why, and no request is sent

### Requirement: Browser-to-central check
`GET /api/traffic/payload?bytes=N` SHALL require `configure_instance`, accept `0 ≤ N ≤ 16 MiB`, and answer exactly `N` incompressible bytes with `Cache-Control: no-store`. Traffic control SHALL offer a check that times several empty requests (latency) and one bounded download (throughput) in the browser and shows the results.

#### Scenario: Oversized payload
- **WHEN** the owner requests `bytes=99999999`
- **THEN** the response is `400`

### Requirement: Traffic control presents network measurements
The Traffic control page SHALL show, in compact cards, the per-Host aggregates, recent and slowest forwarded requests, central→host probe controls per configured Project with their latest results, and the browser→central check, followed by the existing file-access content.

#### Scenario: Owner opens Traffic control
- **WHEN** the super admin opens `/manage/traffic`
- **THEN** it shows the Network cards with aggregates, request tables and probe controls, and the file-access Operations, Scheduling and Activation cards
