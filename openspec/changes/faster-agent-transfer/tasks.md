## 1. Implementation

- [x] 1.1 Agent read-handle streams use 1 MiB prefetched ranges; client clamps handle reads to `maxRangeBytes`
- [x] 1.2 Client offers gzip and decodes gzip responses; file agent compresses file-operation responses when offered
- [x] 1.3 HTML embed allows the document 2 minutes to load; probe stays at 15 s
- [x] 1.4 Tests: agent handle range sizes, Go gzip negotiation, embed timeouts

## 2. Verification

- [ ] 2.1 After deployment, time a large HTML Report from a high-latency agent source before and after the agent upgrade
