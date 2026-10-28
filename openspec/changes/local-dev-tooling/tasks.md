## 1. Implementation

- [x] 1.1 Add `scripts/verify-page.mjs` with wait, eval, click, reload, screenshot steps and a failing exit on missing selectors, 5xx, network failures and page exceptions
- [x] 1.2 Widen AGENTS.md §1.1 to deployment and development facts, add the scripted check to §4.3, and update the `.gitignore` comment
- [x] 1.3 Read extra dev-server origins from `MEMON_ALLOWED_DEV_ORIGINS` in `apps/web/next.config.mjs`, so a preview dev server behind a public hostname keeps HMR

## 2. Verification

- [x] 2.1 Run the script against a healthy page (exit 0; Expand and `expanded=1` observed) and a page whose source is unreachable (exit 1 listing the 5xx requests); run Biome on the script and validate the change
