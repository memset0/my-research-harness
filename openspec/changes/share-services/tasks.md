## 1. Registry and API

- [x] 1.1 Add the optional `service` flag to share records (report/wiki scope only, never with `public`) and carry it through `matchShare`, the registry validator and identity document grants; verify with registry and identity tests
- [x] 1.2 Accept `service: true` in `POST /api/shares` only for documents whose presentation is `service`; list rows carry the flag; verify with route tests

## 2. Gateway

- [x] 2.1 Admit a viewer to the content-service gateway (HTTP and WebSocket, every method) only with a service grant for exactly the requested Host, Project and document; keep owner access and refuse every other grant; verify with server-auth tests

- [x] 2.2 Redeem a service token passed as `share=` on the service URL itself (cookie, then redirect without the token); refuse other tokens with the invalid-link page and pass non-token values through; verify with gateway tests

## 3. UI

- [x] 3.1 Offer "Share service" in the share dialog on service Report and Wiki pages and label service rows; let viewers holding the grant see the live application; verify with component tests

## 4. Verification

- [x] 4.1 Run the touched tests, web typecheck and Biome; after deployment create a service link for a live service Report, open it in a viewer-only session and confirm the page and the service respond while a Project-only token is refused by the service
