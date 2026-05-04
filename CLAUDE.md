# CLAUDE.md — repo conventions and hard-won lessons

This file is loaded into every Claude Code session for this repo. Read it
before doing UI work, before touching shadcn, and before claiming a task is
done.

## Failure modes I've already paid for (don't repeat)

### F1. Claiming UI work is done without looking at the rendered output

**What I did wrong:** I used `pnpm typecheck` passing + `curl -o /dev/null -w "%{http_code}"` returning 200 as proof a feature worked. I committed and reported "shipped" multiple times for pages that were actually unrenderable in a browser.

**Hard rule:** A UI change is not done until I have BOTH:

1. Fetched the served HTML (`curl http://localhost:3737/...`) and confirmed the **markup contains the components I claim to have added** (search for class names, data-slot attributes, the actual text).
2. Fetched the compiled CSS (`curl http://localhost:3737/_next/static/css/app/layout.css?...`) and confirmed the **Tailwind classes I'm using have rules generated** AND **any CSS variables they reference are actually defined in `:root`**. Specifically, search the CSS for `--background:`, `--foreground:`, `--card:`, etc. — if those tokens aren't there, every `bg-card` / `text-foreground` in the page silently falls back to inherit/transparent, and the page looks blank-but-still-200-OK.

If a screenshot/preview tool is available, prefer that over curl. Otherwise the two-curl check is the minimum bar.

`200 OK` proves nothing. The Next.js dev server returns 200 on completely broken renders.

### F2. Hand-rolling shadcn config to bypass interactive init

**What I did wrong:** `pnpm dlx shadcn@latest init` has interactive prompts (component library, preset, base color). I couldn't pipe answers cleanly so I hand-wrote a minimal `components.json` and ran `shadcn add <name>` directly. This *partially* worked but only injected per-component CSS variables (e.g. `shadcn add sidebar` added `--sidebar*` only). The base theme tokens (`--background`, `--foreground`, `--card`, `--muted`, `--primary`, `--secondary`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`) were never written. Every semantic class I subsequently added rendered as broken CSS.

**Hard rule:** When the project needs shadcn or a similar tool with interactive setup:

1. **Ask the user to run `init` themselves.** Tell them which answers to pick. Don't try to bypass it.
2. After init, use `pnpm dlx shadcn@latest add <names...> --yes` for components — this works non-interactively once `components.json` exists from a real init.
3. **Never hand-write theme token blocks in `globals.css`** — that's the canonical output of `shadcn init`, not something to fabricate.

### F3. Forking shadcn components instead of composing

**What I did wrong:** Added `success` and `warning` variants to `components/ui/badge.tsx` directly. This breaks the contract that the file is CLI-overwritten by `shadcn add`, and makes future updates dangerous.

**Hard rule from the [shadcn skills doc](https://ui.shadcn.com/docs/skills):** **NEVER fork shadcn primitives.** If you need a domain-specific variant, create a wrapper component that uses the shadcn primitive underneath with `cn(... , className)` overrides. Example: see `apps/web/components/colored-badge.tsx` for `WarningBadge` / `SuccessBadge` wrapping `Badge`.

### F4. Trusting semantic Tailwind classes without verifying the token

**What I did wrong:** Wrote `bg-card` / `text-foreground` / `border-border` etc. across many files and assumed they'd render because the Tailwind v4 docs say so. They only render if the corresponding CSS variable is defined AND `@theme inline` exposes it as `--color-card: var(--card)`.

**Hard rule:** When introducing or changing a `bg-*-foreground` / `text-*-foreground` / `border-*` semantic class, grep `apps/web/app/globals.css` for the matching `--<token>` variable. If it isn't there, **stop and fix the install (F2)** before touching more components.

## Repo-specific conventions

### Stack

- pnpm monorepo: `packages/core` (TypeScript types, parsers, polling, indexing, LineIndex), `packages/cli` (memon CLI), `apps/web` (Next.js 15 App Router + Tailwind v4 + shadcn/ui)
- Node.js ≥ 20.19 required; pnpm 10.x
- No external DB, no fs watcher (cluster-safe polling with exponential backoff)
- Files-as-source-of-truth: README.md / HYPOTHESES.md / JOURNAL.md per spec

### Hard rules baked into the spec

- **No `fs.watch` / `chokidar` / inotify-based watchers** anywhere. Polling with exponential backoff (default 1s → 5min, factor 2). The user runs on shared clusters with hard inotify limits.
- **All timestamps ISO8601 with timezone offset** (`2026-05-03T08:28:00+08:00`). Never write UTC-converted timestamps to disk.
- **Status enum is uppercase** (`PENDING`/`RUNNING`/`FINISHED`/`FAILED`/`UNKNOWN`). Hypothesis status enum is `CONFIRMED`/`REFUTED`/`PARTIAL`/`OPEN`/`DEFERRED`.
- **Skills (`.claude/skills/*.md`)**: write in **English**. Conversational dialogue with the user is in **Chinese**.
- **Path safety:** any backend route accepting a path parameter MUST go through `assertWithinProjectRoots()` before touching the filesystem.
- **mtime optimistic locking** for README writes; client carries `expectedMtime` (and optional `expectedHash` for low-resolution-mtime safety on NFS).

### Web app conventions (`apps/web`)

- Use shadcn primitives via `@/components/ui/*`. The shim at `components/ui.tsx` re-exports common ones for backward-compat (`Button`, `Card`, `Badge`, `StatusPill`).
- Use the `cn()` helper from `@/lib/utils` — never concatenate Tailwind class strings manually except for tiny inline cases.
- Client components must NOT pull `@memon/core` JS at runtime (transitively imports `fast-glob` → `fs`). Use `import type { ... }` only for client files; runtime symbols like `STATUS_EMOJI` are inlined in `status-pill.tsx`.
- Modals: use shadcn `<Dialog>`, never hand-roll backdrop divs.
- Forms: shadcn `Input` / `Select` / `Textarea` / `Label`, never native `<input>` / `<select>` / `<textarea>` for visible UI.
- Toasts: `sonner`, mounted globally in `app/layout.tsx`.

### Reference docs to consult before changing UI

**First stop — always: <https://ui.shadcn.com/llms.txt>**

This is the LLM-targeted distillation of shadcn's docs. Before any
non-trivial frontend change (new component install, theming, semantic
class change, primitive composition pattern), `WebFetch` this URL and
re-anchor on it. It's the single source of truth for "the shadcn way";
treating it as authoritative will avoid F2 / F3 / F4 above.

Other references (read on demand):

- shadcn skills (AI-targeted rules): <https://ui.shadcn.com/docs/skills>
- shadcn theming: <https://ui.shadcn.com/docs/theming>
- Component-specific: <https://ui.shadcn.com/docs/components/<name>>

## Dev: HTTP API auth — curl with credentials from `config.yml`

The dashboard is gated by HTTP Basic auth (see `openspec/specs/auth-system/`).
**Every** curl/wget against `http://localhost:3737/*` (and the public site)
needs `Authorization: Basic` except for static assets and `/api/auth/check`.
Plaintext credentials live at `config.yml` under `auth.username` /
`auth.password`. Read them at the start of any session that needs to hit the
HTTP API:

```bash
MEMON_USER=$(grep -E '^\s*username:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
MEMON_PASS=$(grep -E '^\s*password:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
# now use:
curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/api/projects
```

If `auth.password` isn't in `config.yml` yet, `memon serve` hasn't been run
once — start it (`cd apps/web && pnpm dev`) and the first request triggers
first-run, which writes a random plaintext password into `config.yml` and
prints it to stdout once. After that, the password persists in `config.yml`
forever (until you rotate it by editing the file).

**Anti-patterns**:

- Don't read from `~/.cache/memon/initial-password.txt` — that path was
  removed; the canonical source is `config.yml`.
- Don't omit `-u` and treat 401 as "the server is down" — first read the
  config and add credentials.
- Don't paste the password into commit messages, PR descriptions, slash
  commands, or anywhere outside the local shell. It's plaintext on disk by
  design (single-user threat model), but that doesn't make it OK to leak.

## Verification protocol for UI changes

Run these in order before claiming done:

```bash
# 0. Read credentials once per session.
MEMON_USER=$(grep -E '^\s*username:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)
MEMON_PASS=$(grep -E '^\s*password:' config.yml | sed -E 's/.*: *"?([^"]+)"?$/\1/' | head -1)

# 1. typecheck
pnpm --filter @memon/web typecheck

# 2. dev server is up (else start it: cd apps/web && pnpm dev)
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 10 -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/

# 3. Fetch a real page and grep for the markup I just added
curl -sS -u "$MEMON_USER:$MEMON_PASS" http://localhost:3737/p/project-a \
  | grep -oE '<class names | data-slot patterns | text I expect>'

# 4. Fetch the compiled CSS and confirm the tokens I rely on are defined.
#    Static assets bypass auth, so no -u needed here.
curl -sS "http://localhost:3737/_next/static/css/app/layout.css?v=$(date +%s)" \
  | grep -E "^  --background:|^  --foreground:|^  --card:|^  --muted:|^  --primary:"
# Each grep must match a single line with an oklch() value.

# 5. (Mobile-sensitive changes) curl with a small viewport-related class search
```

Only after all 5 steps pass do I report "done". `200 OK` is necessary but not sufficient.

## OpenSpec workflow

Changes are tracked under `openspec/changes/<name>/` with proposal.md / design.md / specs/ / tasks.md. Use the `/opsx:propose` and `/opsx:apply` slash commands. `openspec validate <name> --type change` must be clean before committing the proposal.

### Keep spec in sync during `apply`

After running `/opsx:apply`, if the user requests new functionality or
modifications mid-implementation, **update the change artifacts (proposal.md
/ design.md / specs/ / tasks.md) to reflect the new requirements before or
alongside the code edits**. Don't just patch the code and move on — that
leaves the spec stale and the eventual archive will silently bake the
mismatch into the canonical `openspec/specs/`.

Rule of thumb: if a change is significant enough to mention in a commit
message, it's significant enough to land in the spec. Tick / re-open tasks
in tasks.md as scope shifts.

### Archive → commit → push

When the user asks to archive a change and `/opsx:archive` (or the archive
skill) reports success, **default to creating a git commit and pushing to
`origin` immediately afterward** — no extra confirmation needed for the
commit/push step itself once archive succeeded.

Critical: **only stage the files that belong to this change.** Multiple
agents may be editing the working tree concurrently in parallel sessions,
so `git add -A` / `git add .` will sweep up unrelated work and contaminate
the commit. Stage explicitly:

- the change folder being archived (`openspec/changes/<name>/` → moved into
  `openspec/changes/archive/`)
- the synced canonical spec files under `openspec/specs/...`
- the code/test/doc files this change actually touched (cross-check against
  tasks.md and the diff, not against `git status`)

If `git status` shows unrelated modified files from another session, leave
them alone — don't stash, don't reset, don't add. Just stage the precise
paths for this archive and commit.
