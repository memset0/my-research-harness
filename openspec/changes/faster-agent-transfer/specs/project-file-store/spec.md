## ADDED Requirements

### Requirement: Agent transfers minimize round trips and bytes

Streaming a file through an agent read handle SHALL request ranges of up to 1 MiB, bounded by the agent's advertised `maxRangeBytes`, and SHALL request the next range before the consumer asks for it. The central client SHALL offer gzip; the agent SHALL compress file-operation responses for a client that offers it, except service forwarding and bodiless statuses. A client SHALL accept identity responses from agents without compression.

#### Scenario: A large file streams in few round trips
- **WHEN** central streams a 3 MiB file through an agent read handle
- **THEN** it issues about three 1 MiB range reads, each requested while the previous chunk is consumed

#### Scenario: Compression is negotiated
- **WHEN** the client offers gzip to an agent that supports it
- **THEN** the response carries `Content-Encoding: gzip` and decodes to the same JSON, and a 304 stays bodiless
