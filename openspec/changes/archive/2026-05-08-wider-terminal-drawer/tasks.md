## 1. UI change

- [x] 1.1 In `apps/web/components/terminal-drawer-provider.tsx`, change the `<SheetContent>` className from `w-[min(95vw,960px)] sm:max-w-[960px]` to `w-[min(80vw,1280px)] sm:max-w-[1280px]`. Leave all other classes unchanged.

## 2. Verification

- [x] 2.1 `pnpm --filter @memon/web typecheck` passes.
- [x] 2.2 `pnpm --filter @memon/web test` passes.
- [x] 2.3 Rebuild prod via the CLAUDE.md restart sequence; wait until prod is up.
- [x] 2.4 Compiled-chunk verification: the chunk that bundles `terminal-drawer-provider.tsx` contains the new arbitrary-value Tailwind class strings (`w-[min(80vw,1280px)]` and `sm:max-w-[1280px]`); does NOT contain `w-[min(95vw,960px)]` or `sm:max-w-[960px]`. Use grep on the chunks.
- [x] 2.5 Browser check (described, not run via curl): open the drawer on a wide monitor — width is ~1280px; on a narrower viewport (e.g. ~1100px) — width is ~80vw with the underlying page peeking through on the left.
