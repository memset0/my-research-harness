# Tasks

## 1. Accounts and identity

- [x] 1.1 Add `lib/server/account-store.ts` (SQLite accounts + grants, scrypt hashing, account #1 synced from `config.yml`) and verify `account-store.test.ts` covers create/duplicate/disable/level change removing grants/password verify/account #1 immutability
- [x] 1.2 Add `lib/server/auth/capabilities.ts` (level→capability matrix, path→required-capability table, client-safe capability list) and verify `capabilities.test.ts` covers every row of the spec table and every gated path prefix
- [x] 1.3 Extend cookies (v2 session payload), `resolveIdentity` (v1→account #1, v2 lookup, disabled refusal, user/guest→viewer with grants merged with share cookie) and `request-context.ts` (`x-memon-account`), and verify `identity` and `cookies` tests for each case
- [x] 1.4 Wire middleware: account lookup adapter, viewer-role refusal on non-read classes, capability path gating, account header always overwritten; verify `middleware.test.ts` cases (user on mutating → 403, user on cluster API → 403, admin on users API → 403, super admin passes, v1 cookie still owner)
- [x] 1.5 Extend `POST /api/auth/login` to stored accounts with v2 cookies and verify its tests (config owner, stored user, disabled, wrong password)

## 2. Admin API and UI

- [x] 2.1 Add `/api/admin/accounts` (GET, POST), `/api/admin/accounts/[id]` (PATCH), `/api/admin/accounts/[id]/grants` (PUT) and `/api/admin/project-admins` (GET, POST, DELETE) with `manage_accounts` checks, and `/api/project-access` (GET, POST, DELETE) with `manage_project_grants` scoped to granted Projects; add DTOs in `lib/dto/`, route-class rules and manifest entries; verify route tests (super admin CRUD, admin 403 on accounts, account #1 guard, admin sees only granted Projects, identical failure for unknown and non-user names)
- [x] 2.2 Expose `{username, level, capabilities}` through the session bootstrap; add the admin navbar to `app/manage/layout.tsx`, an `/manage` index redirect, a super-admin page guard for File access, the Users page (list, create dialog, level select, disable, reset password, grants editor) and the Projects page (granted Projects, read grants by exact username, admin assignment for the super admin) with query keys from `lib/query-keys.ts`; verify typecheck, Biome and the query-key snapshot
- [x] 2.3 Replace the sidebar footer File access link with the account entry (username, level, Admin link when permitted) and verify `app-sidebar.test.tsx`
- [x] 2.4 Record `created_by` on new shares, scope `/api/shares` list/create/revoke by share manager (super admin all; admin own shares on granted Projects), open the project share dialog for admins, and add the Shares section; verify `app/api/shares/route.test.ts` (admin scoping, legacy attribution, 404 on others' shares)

## 3. Verification

- [x] 3.1 Run root typecheck, Biome on changed files, and the change test list; record results
- [x] 3.2 Verify rendering per AGENTS §4.3 on a 3740 preview with a neutral config: super admin sees the account entry, navbar (Users, File access) and file-access inside admin; an admin account sees only Projects (its granted ones) and no Users/File access; a user account is refused `/manage`. Take desktop and 390 px screenshots with `scripts/verify-page.mjs`
