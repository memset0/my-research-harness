// Next.js 15 instrumentation hook. Auto-detected at server start and run
// during `app.prepare()`.
//
// The actual warmup runs in `apps/web/server.ts` (the tsx entry point) so the
// runtime cache is populated BEFORE Next finishes preparing. That path uses a
// direct `import { getRuntime } from './lib/server/runtime'`, which tsx resolves at
// process load time — Next's bundler never sees it.
//
// This hook can't replicate that import directly, because the server-bundled
// instrumentation chunk traces through @memon/core → fast-glob → fs, which
// fails the Edge-runtime build that Next compiles unconditionally. The old
// opaque-import dance (`new Function('p', 'return import(p)')`) worked
// against webpack's static analysis but isn't resilient against future
// bundler changes.
//
// So instead of trying to import lib/server/runtime here, we just check the
// globalThis flag set by server.ts. If present, the cache is already warm
// and we no-op. If absent, we warn — the runtime will then be initialized
// lazily on the first request (slower, but correct).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const globalAny = globalThis as unknown as { __memonWarmedAt?: number }
  if (typeof globalAny.__memonWarmedAt === 'number') {
    // eslint-disable-next-line no-console
    console.log(
      `memon: instrumentation observed pre-warmed runtime (warmed at ${new Date(
        globalAny.__memonWarmedAt,
      ).toISOString()})`,
    )
    return
  }
  // eslint-disable-next-line no-console
  console.warn(
    'memon: instrumentation register() — runtime was NOT pre-warmed by server.ts; ' +
      'first request will pay the discover/parse cost. (Are you running plain `next dev`?)',
  )
}
