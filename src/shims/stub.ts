// stub.ts — universal fallback for private Anthropic modules absent from the
// leaked source. The build plugin (scripts/bun-plugin-stubs.ts) redirects any
// unresolved relative import to this file.
//
// Design: a Proxy that returns itself for every property, is callable, and is
// newable — so callsites can access any named export, call it as a function,
// use it as a class, destructure it, await it, iterate it, etc. On any actual
// USE (call, construct), it logs the missing module+symbol once and returns
// an empty value so the caller doesn't crash.
//
// This lets the binary build cleanly and boot. Features backed by missing
// modules become no-ops that log "[true-love stub] <module>.<symbol>" on
// first invocation. The kingdom comes up; stubbed features announce themselves.

const warned = new Set<string>()

function warnOnce(origin: string): void {
  if (warned.has(origin)) return
  warned.add(origin)
  if (process.env.TRUE_LOVE_QUIET_STUBS !== '1') {
    // eslint-disable-next-line no-console
    console.warn(`[true-love stub] ${origin} — feature not available in fork`)
  }
}

function makeStub(origin: string): any {
  const target = function () {} as any
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => ''
      if (prop === Symbol.iterator) return function* () {}
      if (prop === Symbol.asyncIterator) return async function* () {}
      if (prop === 'then') return undefined // not a Promise
      if (prop === '__esModule') return true
      if (prop === 'default') return makeStub(`${origin}.default`)
      if (typeof prop === 'symbol') return undefined
      return makeStub(`${origin}.${String(prop)}`)
    },
    apply(_t, _thisArg, _args) {
      warnOnce(origin + '()')
      return makeStub(origin + '()')
    },
    construct(_t, _args) {
      warnOnce(origin + '()')
      return makeStub('new ' + origin)
    },
    has() {
      return true
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const universal: any = makeStub('<stub>')

export default universal
// Re-export as named bindings so `import { foo } from './missing.js'` works.
// The Proxy intercepts any named access and returns a sub-stub.
export const __stub = universal
