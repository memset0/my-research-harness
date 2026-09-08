## 1. Reading layout

- [x] 1.1 Center the 720px-capped document with an adjacent sticky desktop outline; verify focused layout assertions.
- [x] 1.2 Remove the whole-body quote treatment and mobile inline outline without removing review metadata; verify focused regression assertions.

## 2. Verification

- [x] 2.1 Run wiki-shell tests and Web typecheck; inspect served markup/CSS and desktop/mobile rendering before completion.

Verification: 3 focused component tests passed; Web typecheck and production build passed. Browser inspection at 1600px and 390px confirmed plain body styling, desktop group centering, 24px outline spacing, sticky scrolling, and hidden mobile navigation. Compiled CSS contains the 720px maximum-width rule and required theme tokens. The initial HTML is a client-loading shell; assertions use the hydrated served page, with desktop/mobile screenshots visually inspected. No full-suite run.
