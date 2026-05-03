// Next.js 15 instrumentation hook. Auto-detected at server start (both `next
// dev` and `next start`). We use it to eagerly warm the runtime so the very
// first HTTP request doesn't pay the full discover + parse + cache-build
// cost (which can be 14 seconds in dev mode).
//
// Reference: https://nextjs.org/docs/app/api-reference/config/next-config-js/instrumentation
//
// Why the Function() dance below: Next.js bundles instrumentation.ts for BOTH
// the Node and Edge runtimes. A direct `import('./lib/runtime')` makes webpack
// trace the import graph through @memon/core → fast-glob → fs, which fails
// for the Edge build. Using `new Function(...)` to construct the dynamic
// import keeps webpack from statically tracing the path, so at runtime it
// resolves via Node only — Edge skips this whole hook via the early return.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // eslint-disable-next-line no-console
  console.log('memon: instrumentation register() — warming up runtime')
  try {
    // biome-ignore lint/security/noGlobalEval: see header comment
    const opaqueImport = new Function('p', 'return import(p)') as (
      p: string,
    ) => Promise<{ getRuntime: () => Promise<unknown> }>
    const mod = await opaqueImport('./lib/runtime')
    await mod.getRuntime()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('memon: warmup failed', err)
  }
}
