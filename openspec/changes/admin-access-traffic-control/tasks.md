## 1. Admin restructure

- [x] 1.1 Sections Clusters / Access control / Traffic control with path rules for `/manage/access`, `/manage/traffic`, `/api/traffic`; update capability tests
- [x] 1.2 `/manage/access` page with Users, Projects and Shares cards (per-card capability), panels rendered as cards
- [x] 1.3 `/manage/traffic` page hosting the file-access content; redirects from `/manage/{users,projects,shares,file-access}`

## 2. Traffic tracking

- [x] 2.1 Bounded in-memory tracker (ring buffer, minute aggregates, probe results) with path sanitization; unit tests
- [x] 2.2 Gateway instrumentation of service HTTP, WebSocket and content-asset requests; probe hook registration
- [x] 2.3 Probes: File Agent capability round trips, SSH echo + bounded download, native, service re-fetch; unit tests with fakes
- [x] 2.4 Routes `GET /api/traffic`, `POST /api/traffic/probe`, `GET /api/traffic/payload`; route classes, manifest, auth tests
- [x] 2.5 Traffic control Network cards: aggregates, recent/slowest tables, probe controls, browser→central check

## 3. Verification

- [x] 3.1 Typecheck, Biome and the selected tests
- [x] 3.2 Rendered check (super admin and admin views) on a preview server and after deployment
