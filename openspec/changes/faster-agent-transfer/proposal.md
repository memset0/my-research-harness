## Why

Large files from a File Agent source load slowly on high-latency links. A 3 MB HTML Report took about 38 s because central streamed it as sequential 64 KiB range reads (one round trip each) of base64 JSON, and the embed gave up after 15 s even though the document was still arriving.

## What Changes

- Agent read-handle streams request ranges of up to 1 MiB, bounded by the agent's advertised range limit, and request the next range while the consumer takes the current one.
- A handle read above the agent's range limit becomes a short read instead of an error.
- The central client sends `Accept-Encoding: gzip`; the file agent gzip-compresses file-operation responses when asked (not service forwarding, not bodiless statuses). Agents without compression keep working.
- The HTML embed bounds the probe's response headers by 15 s as before, but allows the document itself 2 minutes to finish loading.

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-file-store`: agent streams use large prefetched ranges and negotiated compression.
- `content-bundles`: a slow document load is not an error before 2 minutes.

## Impact

`packages/file-protocol/src/client.ts`, `packages/core/src/project-file-store/agent-handle.ts`, `packages/file-agent/internal/agent/{server,gzip}.go`, `apps/web/components/report-html-embed.tsx` and tests. Central changes ship as a PATCH release; compression needs the file agent rebuilt and reinstalled on each source.
