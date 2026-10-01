// Vitest stand-in for Next's `server-only` guard. In a Next bundle the bare
// specifier resolves to an empty module for server code and to a build error
// for client code; Node tests only need it to resolve.
export {}
